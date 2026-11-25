import type {
  IMAGE_LIMITS as CoreImageLimits,
  MessageImage,
} from '@familiar-ai/core/http'

/**
 * What a message's images may be, as core admits them: typed against it, so
 * a change there is a type error here, without loading its runtime. A client
 * prepares each image to fit before sending.
 */
export const IMAGE_LIMITS: typeof CoreImageLimits = {
  count: 10,
  bytes: 1_500_000,
  pixels: 1568,
}

/** An image to send: base64, which core checks is a PNG, JPEG, GIF or WebP. */
export type OutgoingImage = Pick<MessageImage, 'data' | 'mimeType'>
