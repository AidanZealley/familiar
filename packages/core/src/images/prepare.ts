import type { ImageProcessor } from '@earendil-works/pi-durable/tools'
import { imageSize } from 'image-size'
import type { StoredImage } from './store.ts'
import { IMAGE_LIMITS, ImageError, type ImageId } from './types.ts'

/** The formats every model provider takes inline, by their leading bytes. */
const IMAGE_SIGNATURES: [
  mimeType: string,
  matches: (head: string) => boolean,
][] = [
  ['image/png', (head) => head.startsWith('\x89PNG\r\n\x1a\n')],
  ['image/jpeg', (head) => head.startsWith('\xff\xd8\xff')],
  ['image/gif', (head) => /^GIF8[79]a/.test(head)],
  [
    'image/webp',
    (head) => head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP',
  ],
]

const typeOf = (bytes: Uint8Array) => {
  const head = String.fromCharCode(...bytes.subarray(0, 12))
  return IMAGE_SIGNATURES.find(([, matches]) => matches(head))?.[0]
}

/** Width and height from `bytes`' header, without decoding the pixels. */
const sizeOf = (bytes: Uint8Array) => {
  try {
    const { width, height } = imageSize(bytes)
    return { width, height }
  } catch {
    throw new ImageError('unreadable')
  }
}

export const fromBase64 = (data: string) =>
  Uint8Array.from(atob(data), (char) => char.charCodeAt(0))

const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ).subarray(0, 16),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')

/**
 * `bytes` prepared to store: upright, within `IMAGE_LIMITS`, with its ID,
 * the hash of what's stored, so uploading the same image twice stores it
 * once. Throws an ImageError `unsupported` for anything but PNG, JPEG, GIF
 * or WebP; `too-large` for more than `maxPixels`, checked from the header
 * before anything decodes it; and `unreadable` for what doesn't decode.
 */
export async function prepareImage(
  processor: ImageProcessor,
  bytes: Uint8Array,
  maxPixels: number,
): Promise<{ id: ImageId; image: StoredImage }> {
  if (bytes.byteLength > IMAGE_LIMITS.upload) {
    throw new ImageError('too-large')
  }
  const type = typeOf(bytes)
  if (!type) {
    throw new ImageError('unsupported')
  }
  const { width, height } = sizeOf(bytes)
  if (width * height > maxPixels) {
    throw new ImageError('too-large')
  }
  const prepared = await processor.prepare(
    bytes,
    // Photon returns an image in a type providers take inline as it is, so
    // an animated GIF would stay animated. Labelled as a type they don't
    // take, it's encoded anew from its first frame, as a PNG.
    type === 'image/gif' ? 'image/gif-still' : type,
    {
      maxWidth: IMAGE_LIMITS.pixels,
      maxHeight: IMAGE_LIMITS.pixels,
      maxBytes: IMAGE_LIMITS.bytes,
    },
  )
  if (!prepared) {
    throw new ImageError('unreadable')
  }
  const output = fromBase64(prepared.data)
  return {
    id: await hash(output),
    image: {
      data: prepared.data,
      // Read from what Photon made, not its label.
      mimeType: typeOf(output) ?? prepared.mimeType,
      ...sizeOf(output),
    },
  }
}
