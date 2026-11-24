import {
  checkImage,
  IMAGE_LIMITS,
  type OutgoingImage,
} from '@familiar-ai/client'

/** Formats Familiar takes as they are, when they're small enough. */
const AS_IS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** How long `blob`'s base64 is: four characters for every three bytes. */
const base64Length = (blob: Blob) => Math.ceil(blob.size / 3) * 4

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      type,
      0.85,
    ),
  )

/**
 * `file` as a message image, within `IMAGE_LIMITS`: as it is when core's
 * `checkImage` takes it, so a GIF keeps its frames; otherwise, as for one
 * with too many frames, too large, or whose bytes core reads differently
 * from the browser, drawn upright as a still, shrunk to the longest side
 * allowed, and encoded as PNG when it was one and still fits, else as JPEG,
 * smaller until it fits. Rejects for what the browser can't decode.
 */
export async function prepareImage(file: Blob): Promise<OutgoingImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const { pixels, bytes } = IMAGE_LIMITS
    const longest = Math.max(bitmap.width, bitmap.height)
    if (
      AS_IS.has(file.type) &&
      longest <= pixels &&
      base64Length(file) <= bytes &&
      typeof checkImage(new Uint8Array(await file.arrayBuffer())) !== 'string'
    ) {
      return { data: await toBase64(file), mimeType: file.type }
    }
    const canvas = document.createElement('canvas')
    for (let scale = Math.min(1, pixels / longest); ; scale *= 0.75) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')!
      for (const type of file.type === 'image/png'
        ? ['image/png', 'image/jpeg']
        : ['image/jpeg']) {
        // JPEG has no transparency: what's clear shows white, not black.
        context.fillStyle = type === 'image/jpeg' ? '#fff' : 'transparent'
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await encode(canvas, type)
        if (base64Length(blob) <= bytes) {
          return { data: await toBase64(blob), mimeType: type }
        }
      }
    }
  } finally {
    bitmap.close()
  }
}

/** Whether `file` is an image, by the type the browser gives it. */
export const isImage = (file: File) => file.type.startsWith('image/')

/** A message image as an `<img>` source. */
export const imageSource = ({ data, mimeType }: OutgoingImage) =>
  `data:${mimeType};base64,${data}`
