/**
 * What an image may be. The daemon or Worker prepares each upload to fit,
 * with Photon: each image costs the models tokens on every turn until its
 * chat compacts, and past about 1568px they gain little.
 */
export const IMAGE_LIMITS = {
  /** Images per message. */
  count: 10,
  /** Characters of base64 a prepared image may take. */
  bytes: 1_500_000,
  /** The longest side of a prepared image, in pixels. */
  pixels: 1568,
  /** Bytes an upload may be before it's prepared. */
  upload: 20 * 1024 * 1024,
} as const

/** An image's ID: the first 32 hex characters of its prepared bytes' SHA-256. */
export type ImageId = string

export const isImageId = (value: unknown): value is ImageId =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

/** An image as a message refers to it: which, its type, and its size. */
export type ImageRef = {
  id: ImageId
  mimeType: string
  width: number
  height: number
}

/**
 * Why an image was refused, as data for hosts to word:
 * - `unsupported`: not a PNG, JPEG, GIF or WebP, such as HEIC.
 * - `too-large`: more bytes or pixels than this host prepares.
 * - `unreadable`: its bytes don't decode as an image.
 * - `missing`: a message names an image that isn't stored, such as an
 *   upload left a day without a message and retired.
 * - `unavailable`: this host prepares no images.
 */
export type ImageErrorCode =
  'unsupported' | 'too-large' | 'unreadable' | 'missing' | 'unavailable'

/** Plain words for each code, for callers that don't word them themselves. */
const MESSAGES: Record<ImageErrorCode, string> = {
  unsupported: 'Images must be PNG, JPEG, GIF or WebP.',
  'too-large': 'That image is too large.',
  unreadable: "That image couldn't be read.",
  missing: 'An image this message names is no longer stored; upload it again.',
  unavailable: 'This host takes no images.',
}

/** An image refused, or a message naming one that isn't stored; nothing changed. */
export class ImageError extends Error {
  readonly code: ImageErrorCode
  constructor(code: ImageErrorCode) {
    super(MESSAGES[code])
    this.code = code
  }
}
