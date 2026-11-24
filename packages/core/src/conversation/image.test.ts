import { expect, test } from 'vitest'
import { readImageHeader } from './image.ts'

const u32be = (value: number) => [
  value >>> 24,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]
const u32le = (value: number) => u32be(value).reverse()
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

/** A PNG of `chunks`, each `[type, data]`; CRCs aren't checked, so zero. */
const png = (...chunks: [string, number[]][]) =>
  new Uint8Array([
    0x89,
    ...ascii('PNG\r\n\x1a\n'),
    ...chunks.flatMap(([type, data]) => [
      ...u32be(data.length),
      ...ascii(type),
      ...data,
      0,
      0,
      0,
      0,
    ]),
  ])
const ihdr = (width: number, height: number): [string, number[]] => [
  'IHDR',
  [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0],
]

test('an image is read only when its structure is complete and consistent', () => {
  expect(readImageHeader(png(ihdr(2, 3), ['IDAT', [0]], ['IEND', []]))).toEqual(
    { mimeType: 'image/png', width: 2, height: 3, frames: 1 },
  )
  for (const bytes of [
    // Only empty image data.
    png(ihdr(2, 3), ['IDAT', []], ['IEND', []]),
    // A second header, to pass a small size and then a large one.
    png(ihdr(2, 3), ihdr(9999, 9999), ['IDAT', [0]], ['IEND', []]),
    // A frame count after the image data, or twice.
    png(
      ihdr(2, 3),
      ['IDAT', [0]],
      ['acTL', [...u32be(1), 0, 0, 0, 0]],
      ['IEND', []],
    ),
    // A WebP chunk reaching past the RIFF size it declares.
    new Uint8Array([
      ...ascii('RIFF'),
      ...u32le(4 + 8 + 10),
      ...ascii('WEBPVP8L'),
      ...u32le(20),
      0x2f,
      ...Array(19).fill(0),
    ]),
  ]) {
    expect(readImageHeader(bytes)).toBe('corrupt')
  }
})

test("a GIF's size covers images reaching past its screen", () => {
  const gif = new Uint8Array([
    ...ascii('GIF89a'),
    ...[1, 0, 1, 0, 0, 0, 0],
    // An image at (0, 0) of 2000 × 1, uncompressed data of one empty block.
    0x2c,
    ...[0, 0, 0, 0, 0xd0, 0x07, 1, 0, 0],
    2,
    0,
    0x3b,
  ])
  expect(readImageHeader(gif)).toMatchObject({ width: 2000, height: 1 })
})
