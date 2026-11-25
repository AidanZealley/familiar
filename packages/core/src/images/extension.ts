import type { ImageContent, Message } from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
} from '@earendil-works/pi-durable'
import { Images } from './store.ts'
import type { ImageId, ImageRef } from './types.ts'

/** How a chat's model message refers to a stored image, in place of its bytes. */
const REFERENCE = 'familiar-image:'

/** An image part that refers to the stored image `ref`. */
export const imageReference = ({ id, mimeType }: ImageRef): ImageContent => ({
  type: 'image',
  mimeType,
  data: `${REFERENCE}${id}`,
})

const referenced = (part: { type: string; data?: string }) =>
  part.type === 'image' && !!part.data?.startsWith(REFERENCE)

/**
 * Stored images in chat: model messages keep a reference to each, and every
 * request swaps in its bytes, for that request only. An image that's gone
 * is shown as text saying so. Everything else, inline images included, is
 * left as it is.
 */
export const imagesExtension = defineExtension({
  name: 'familiar.images',
  hooks: [
    hook(GenerationTask, {
      beforeRequest: async ({ messages }, api, context) => {
        if (
          !messages.some(
            (message) =>
              message.role === 'user' &&
              Array.isArray(message.content) &&
              message.content.some(referenced),
          )
        ) {
          return
        }
        const resolve = async (part: { type: string; data?: string }) => {
          if (!referenced(part)) {
            return part
          }
          const id: ImageId = part.data!.slice(REFERENCE.length)
          const image = await api.snapshot(Images, id, context)
          return image?.data
            ? { type: 'image', mimeType: image.mimeType, data: image.data }
            : { type: 'text', text: '[image unavailable]' }
        }
        return {
          messages: await Promise.all(
            messages.map(async (message) =>
              message.role === 'user' && Array.isArray(message.content)
                ? ({
                    ...message,
                    content: await Promise.all(message.content.map(resolve)),
                  } as Message)
                : message,
            ),
          ),
        }
      },
    }),
  ],
})
