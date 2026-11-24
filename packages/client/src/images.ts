import type { MessageImage } from '@familiar-ai/core/http'

// Core's own image rules, which are browser-safe code with no imports, so a
// client checks an image just as core will before sending it.
export {
  checkImage,
  IMAGE_LIMITS,
  type ImageProblem,
} from '@familiar-ai/core/image'

/** An image to send: base64, which core checks is a whole PNG, JPEG, GIF or WebP. */
export type OutgoingImage = Pick<MessageImage, 'data' | 'mimeType'>
