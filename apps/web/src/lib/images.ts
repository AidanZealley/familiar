import { IMAGE_LIMITS, type ImageErrorCode } from '@familiar-ai/client'

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      type,
      0.85,
    ),
  )

/**
 * `file` as it's best uploaded: as it is when it's a GIF or already no
 * larger than the daemon keeps, else drawn upright at that size and encoded
 * once, as PNG if it was one and JPEG otherwise, so a phone photo sends
 * hundreds of kilobytes, not megabytes. The daemon prepares what's stored,
 * so anything the browser can't decode goes as it is, for the daemon to
 * decide.
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  if (file.type === 'image/gif') {
    return file
  }
  const bitmap = await createImageBitmap(file).catch(() => undefined)
  if (!bitmap) {
    return file
  }
  try {
    const scale = IMAGE_LIMITS.pixels / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) {
      return file
    }
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')!
    // JPEG has no transparency: what's clear shows white, not black.
    if (type === 'image/jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await encode(canvas, type).catch(() => file)
  } finally {
    bitmap.close()
  }
}

/** Whether `file` is an image, by the type the browser gives it. */
export const isImage = (file: File) => file.type.startsWith('image/')

/** Why the daemon refused an upload, in the composer's words. */
export const refusalOf = (code: ImageErrorCode) =>
  ({
    unsupported:
      "That image's format isn't supported: try a PNG, JPEG or WebP.",
    'too-large': 'That image is too large.',
    unreadable: "That image couldn't be read.",
    missing: 'That image is no longer stored. Attach it again.',
    unavailable: "This Familiar can't take images.",
  })[code]
