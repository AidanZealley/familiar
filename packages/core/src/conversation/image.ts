/**
 * What an image's own structure says it is: its format, size and frames,
 * read from its headers without decoding its pixels.
 */
export type ImageHeader = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  width: number
  height: number
  frames: number
}

/**
 * Why an image was refused, as data for a host to word: not a format every
 * model provider takes; one whose structure doesn't parse, as when it's
 * truncated; or one larger, in pixels or frames, than `IMAGE_LIMITS`.
 */
export type ImageProblem = 'format' | 'corrupt' | 'pixels' | 'frames'

/**
 * `bytes` as a PNG, JPEG, GIF or WebP, by its signature, walked to its end
 * so that a truncated or corrupt one is refused: `'format'` for any other
 * signature, `'corrupt'` for structure that doesn't parse. Pixels aren't
 * decoded, so a damaged pixel stream can still pass.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | ImageProblem {
  const read = READERS.find(([signature]) => signature(bytes))?.[1]
  if (!read) {
    return 'format'
  }
  try {
    const header = read(reader(bytes))
    return header.width > 0 && header.height > 0 && header.frames > 0
      ? header
      : 'corrupt'
  } catch {
    return 'corrupt'
  }
}

/** Bounds-checked reads of `bytes`; any read past the end throws. */
function reader(bytes: Uint8Array) {
  const at = (offset: number) => {
    if (!(offset >= 0 && offset < bytes.length)) {
      throw new RangeError('truncated')
    }
    return bytes[offset]
  }
  const u16be = (offset: number) => (at(offset) << 8) | at(offset + 1)
  const u16le = (offset: number) => at(offset) | (at(offset + 1) << 8)
  return {
    bytes,
    length: bytes.length,
    at,
    u16be,
    u16le,
    u24le: (offset: number) => u16le(offset) | (at(offset + 2) << 16),
    u32be: (offset: number) => u16be(offset) * 0x10000 + u16be(offset + 2),
    u32le: (offset: number) => u16le(offset) + u16le(offset + 2) * 0x10000,
    text: (offset: number, length: number) =>
      String.fromCharCode(
        ...Array.from({ length }, (_, index) => at(offset + index)),
      ),
  }
}

type Bytes = ReturnType<typeof reader>

const starts = (prefix: number[]) => (bytes: Uint8Array) =>
  prefix.every((byte, index) => bytes[index] === byte)

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

/**
 * Chunks, from the signature to IEND: one IHDR, first; at most one acTL,
 * APNG's frame count, before the image data; and image data, not empty.
 */
function readPng(bytes: Bytes): ImageHeader {
  let offset = 8
  let header: { width: number; height: number } | undefined
  let frames = 1
  let animated = false
  let data = false
  for (;;) {
    const length = bytes.u32be(offset)
    const type = bytes.text(offset + 4, 4)
    // The chunk's data and CRC must be there.
    bytes.at(offset + 12 + length - 1)
    if (!header !== (type === 'IHDR')) {
      throw new Error('IHDR not first, or repeated')
    }
    if (type === 'IHDR') {
      if (length !== 13) {
        throw new Error('bad IHDR')
      }
      header = {
        width: bytes.u32be(offset + 8),
        height: bytes.u32be(offset + 12),
      }
    } else if (type === 'acTL') {
      if (length !== 8 || animated || data) {
        throw new Error('bad acTL')
      }
      animated = true
      frames = bytes.u32be(offset + 8)
    } else if (type === 'IDAT') {
      data ||= length > 0
    } else if (type === 'IEND') {
      if (!data) {
        throw new Error('no IDAT')
      }
      return { mimeType: 'image/png', ...header!, frames }
    }
    offset += 12 + length
  }
}

/** Segments, from SOI to the scan, which must end with EOI. */
function readJpeg(bytes: Bytes): ImageHeader {
  let offset = 2
  let header: { width: number; height: number } | undefined
  for (;;) {
    if (bytes.at(offset) !== 0xff) {
      throw new Error('not a marker')
    }
    const marker = bytes.at(offset + 1)
    if (marker === 0xff) {
      // Fill bytes before a marker.
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = bytes.u16be(offset + 2)
    bytes.at(offset + 1 + length)
    // Start of frame, but not DHT (C4), JPG (C8) or DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      header = {
        height: bytes.u16be(offset + 5),
        width: bytes.u16be(offset + 7),
      }
    }
    if (marker === 0xda) {
      // The compressed scan follows, to an EOI at or near the end.
      const tail = bytes.bytes.subarray(offset + 2 + length)
      if (!header || !hasEoi(tail)) {
        throw new Error('no frame or end')
      }
      return { mimeType: 'image/jpeg', ...header, frames: 1 }
    }
    offset += 2 + length
  }
}

/** Whether a JPEG's scan ends with EOI, allowing trailing padding. */
const hasEoi = (tail: Uint8Array) => {
  let end = tail.length
  while (end > 0 && tail[end - 1] === 0) {
    end -= 1
  }
  return end >= 2 && tail[end - 2] === 0xff && tail[end - 1] === 0xd9
}

/**
 * Blocks, from the screen descriptor to the trailer, counting images. Its
 * size covers every image, which may reach past the screen.
 */
function readGif(bytes: Bytes): ImageHeader {
  let width = bytes.u16le(6)
  let height = bytes.u16le(8)
  const flags = bytes.at(10)
  let offset = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0)
  let frames = 0
  const subBlocks = () => {
    for (let size = bytes.at(offset); size; size = bytes.at(offset)) {
      offset += size + 1
    }
    offset += 1
  }
  for (;;) {
    const block = bytes.at(offset)
    if (block === 0x3b) {
      return { mimeType: 'image/gif', width, height, frames }
    }
    if (block === 0x21) {
      offset += 2
      subBlocks()
    } else if (block === 0x2c) {
      const [w, h] = [bytes.u16le(offset + 5), bytes.u16le(offset + 7)]
      if (!w || !h) {
        throw new Error('empty image')
      }
      width = Math.max(width, bytes.u16le(offset + 1) + w)
      height = Math.max(height, bytes.u16le(offset + 3) + h)
      const local = bytes.at(offset + 9)
      offset += 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0)
      // LZW minimum code size, then the image data.
      bytes.at(offset)
      offset += 1
      subBlocks()
      frames += 1
    } else {
      throw new Error('unknown block')
    }
  }
}

/** RIFF chunks, within the size the header gives, counting frames. */
function readWebp(bytes: Bytes): ImageHeader {
  const end = 8 + bytes.u32le(4)
  if (end > bytes.length) {
    throw new Error('truncated')
  }
  let offset = 12
  let canvas: { width: number; height: number } | undefined
  let frames = 0
  while (offset < end) {
    const type = bytes.text(offset, 4)
    const length = bytes.u32le(offset + 4)
    const data = offset + 8
    // Within the RIFF size, not only the bytes there are.
    if (data + length > end) {
      throw new Error('chunk past the end')
    }
    if (type === 'VP8X') {
      canvas = {
        width: bytes.u24le(data + 4) + 1,
        height: bytes.u24le(data + 7) + 1,
      }
    } else if (type === 'ANMF') {
      frames += 1
    } else if (type === 'VP8 ' && !canvas) {
      if (bytes.text(data + 3, 3) !== '\x9d\x01\x2a') {
        throw new Error('no VP8 start code')
      }
      canvas = {
        width: bytes.u16le(data + 6) & 0x3fff,
        height: bytes.u16le(data + 8) & 0x3fff,
      }
      frames = 1
    } else if (type === 'VP8L' && !canvas) {
      if (bytes.at(data) !== 0x2f) {
        throw new Error('no VP8L signature')
      }
      const bits = bytes.u32le(data + 1)
      canvas = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      }
      frames = 1
    } else if ((type === 'VP8 ' || type === 'VP8L') && !frames) {
      frames = 1
    }
    // Chunks are padded to an even length.
    offset = data + length + (length & 1)
  }
  if (!canvas) {
    throw new Error('no image')
  }
  return { mimeType: 'image/webp', ...canvas, frames }
}

const READERS: [
  signature: (bytes: Uint8Array) => boolean,
  read: (bytes: Bytes) => ImageHeader,
][] = [
  [starts([0x89, ...ascii('PNG\r\n\x1a\n')]), readPng],
  [starts([0xff, 0xd8, 0xff]), readJpeg],
  [
    (bytes) => starts(ascii('GIF87a'))(bytes) || starts(ascii('GIF89a'))(bytes),
    readGif,
  ],
  [
    (bytes) =>
      starts(ascii('RIFF'))(bytes) && starts(ascii('WEBP'))(bytes.subarray(8)),
    readWebp,
  ],
]
