import { defineDoc, defineDocFamily, type Tx } from '@earendil-works/pi-durable'
import { ImageError, type ImageId, type ImageRef } from './types.ts'

/**
 * Where images live: one write-once document per image, keyed by the hash
 * of its prepared bytes, and a list of those no message has claimed yet.
 * Every change is a commit on the Harness's one mutation line, so an
 * upload, a post and the sweep never interleave.
 *
 * An image in `unclaimed` is retired by the first upload after it's been
 * there a day. Posting a message removes its images from `unclaimed` in the
 * same commit, and nothing deletes messages, so a claimed image is kept for
 * good and no message can point at a retired one.
 */

/** A prepared image, as stored: never changed once written. */
export type StoredImage = {
  /** Base64 of the prepared bytes. */
  data: string
  /** Read from the prepared bytes. */
  mimeType: string
  width: number
  height: number
}

/** Each stored image, by ImageId. Empty `data` means no image is stored. */
export const Images = defineDocFamily<StoredImage, null>({
  kind: 'familiar.images',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ data: '', mimeType: '', width: 0, height: 0 }),
  checkpointWhen: () => true, // written once, whole
})

/** Uploads no message has claimed, with when each was uploaded, in ms. */
export const Uploads = defineDoc<{ unclaimed: Record<ImageId, number> }>({
  kind: 'familiar.uploads',
  version: 1,
  scope: 'session',
  initial: () => ({ unclaimed: {} }),
  checkpointWhen: () => true, // small: always store it whole
})

/** How long an upload waits for a message before a later upload retires it. */
export const UNCLAIMED_FOR = 24 * 60 * 60 * 1000

/**
 * Stores `image` as `id`, uploaded at `now`, unless it's stored already, in
 * the commit `tx`; and retires every upload left unclaimed too long.
 * Uploading the same image again only keeps it unclaimed for longer, if it
 * still is.
 */
export async function storeImage(
  tx: Tx,
  id: ImageId,
  image: StoredImage,
  now: number,
) {
  const { unclaimed } = await tx.doc(Uploads)
  const stored = await tx.doc(Images, id, null)
  if (!stored.data) {
    Object.assign(stored, image)
    unclaimed[id] = now
  } else if (id in unclaimed) {
    unclaimed[id] = now
  }
  for (const [other, at] of Object.entries(unclaimed)) {
    if (now - at > UNCLAIMED_FOR) {
      await tx.retireDoc(Images, other)
      delete unclaimed[other]
    }
  }
}

/**
 * Each of `ids` as a message refers to it, claimed for good in the commit
 * `tx`. Throws an ImageError `missing` for one that isn't stored, which
 * fails the commit, so nothing is claimed or created.
 */
export async function claimImages(
  tx: Tx,
  ids: readonly ImageId[],
): Promise<ImageRef[]> {
  const { unclaimed } = await tx.doc(Uploads)
  const refs: ImageRef[] = []
  for (const id of ids) {
    const { data, mimeType, width, height } = await tx.doc(Images, id, null)
    if (!data) {
      throw new ImageError('missing')
    }
    delete unclaimed[id]
    refs.push({ id, mimeType, width, height })
  }
  return refs
}
