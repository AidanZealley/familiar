import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import type { ImageProcessor } from '@earendil-works/pi-durable/tools'
import { fromBase64, prepareImage } from './prepare.ts'
import { Images, storeImage } from './store.ts'
import { ImageError, isImageId, type ImageId, type ImageRef } from './types.ts'

export { imagesExtension, imageReference } from './extension.ts'
export { claimImages } from './store.ts'
export * from './types.ts'

export type ImagesOptions = {
  /**
   * Prepares each upload: Photon, as `createNodePhotonImages()` from
   * `@familiar-ai/core/node` or `createCloudflarePhotonImages()` from
   * `@familiar-ai/cloudflare/images`.
   */
  processor: ImageProcessor
  /**
   * The most pixels an upload may have, read from its header before it's
   * decoded: decoding takes four bytes a pixel. Default 40 million, enough
   * for phone photos; lower it on hosts with little memory.
   */
  maxPixels?: number
}

/** The images messages carry, uploaded before the message that claims them. */
export type ImagesApi = {
  /**
   * Prepares `bytes` and stores it, unclaimed until a message names it, for
   * a day. The same image uploaded twice is stored once, under one ID.
   * Rejects with an ImageError for an image that's refused, or `unavailable`
   * when the host gave no processor.
   */
  upload(bytes: Uint8Array): Promise<ImageRef>
  /** A stored image's bytes and type, or undefined if there's none. */
  get(id: ImageId): Promise<{ bytes: Uint8Array; mimeType: string } | undefined>
}

const DEFAULT_MAX_PIXELS = 40_000_000

const context = BACKGROUND_CONTEXT

export function createImages(
  harness: Harness,
  options: ImagesOptions | undefined,
  now: () => number,
): ImagesApi {
  return {
    upload: async (bytes) => {
      if (!options) {
        throw new ImageError('unavailable')
      }
      const { id, image } = await prepareImage(
        options.processor,
        bytes,
        options.maxPixels ?? DEFAULT_MAX_PIXELS,
      )
      await harness.commit((tx) => storeImage(tx, id, image, now()), context)
      const { mimeType, width, height } = image
      return { id, mimeType, width, height }
    },
    get: async (id) => {
      const image = isImageId(id)
        ? await harness.snapshot(Images, id, context)
        : undefined
      return image?.data
        ? {
            bytes: fromBase64(image.data),
            mimeType: image.mimeType,
          }
        : undefined
    },
  }
}
