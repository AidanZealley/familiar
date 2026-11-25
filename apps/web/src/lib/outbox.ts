import {
  ImageUploadError,
  type ImageRef,
  type UploadOptions,
} from '@familiar-ai/client'
import { createStore } from 'zustand/vanilla'
import { shrinkForUpload } from './images'

/**
 * Where an image's upload is: sending bytes, waiting while the daemon
 * prepares it, stored as `ref`, or failed before the daemon answered,
 * which trying again may fix. A refused upload has no state: it's gone.
 */
export type UploadState =
  | { status: 'uploading'; loaded: number; total: number }
  | { status: 'preparing' }
  | { status: 'ready'; ref: ImageRef }
  | { status: 'failed' }

/** Uploads a blob to the open room, as the room store's `uploadImage`. */
export type Uploader = (blob: Blob, options: UploadOptions) => Promise<ImageRef>

/**
 * Images on their way to the daemon, by the key of the draft image that
 * owns each. Kept for the page's life, apart from the composer, so stage
 * 2's pending messages can wait on them. `upload` is the only writer; each
 * key is removed by `forget`, or by a refusal.
 */
export const outbox = createStore<{
  uploads: ReadonlyMap<number, UploadState>
}>(() => ({ uploads: new Map() }))

/** Each running upload's abort, by key. Not state: nothing renders it. */
const running = new Map<number, AbortController>()

const set = (key: number, state: UploadState | undefined) =>
  outbox.setState(({ uploads }) => {
    const next = new Map(uploads)
    if (state) {
      next.set(key, state)
    } else {
      next.delete(key)
    }
    return { uploads: next }
  })

/**
 * Uploads `file` as `key`, shrunk first, then `ready` or `failed`. Rejects
 * with the ImageUploadError when the daemon refused it, whose `code` says
 * why, and removes it. Uploading a failed key again tries again.
 */
export async function upload(key: number, file: File, uploader: Uploader) {
  const controller = new AbortController()
  running.set(key, controller)
  // Every write goes through here, so once forgotten, nothing comes back.
  const update = (state: UploadState | undefined) => {
    if (!controller.signal.aborted) {
      set(key, state)
    }
  }
  update({ status: 'uploading', loaded: 0, total: file.size })
  try {
    const ref = await uploader(await shrinkForUpload(file), {
      signal: controller.signal,
      onProgress: (loaded, total) =>
        update(
          loaded < total
            ? { status: 'uploading', loaded, total }
            : { status: 'preparing' },
        ),
    })
    update({ status: 'ready', ref })
  } catch (error) {
    if (controller.signal.aborted) {
      return
    }
    if (error instanceof ImageUploadError && error.code) {
      update(undefined)
      throw error
    }
    update({ status: 'failed' })
  } finally {
    running.delete(key)
  }
}

/** Stops `keys`' uploads, if they're running, and drops them. */
export function forget(keys: readonly number[]) {
  for (const key of keys) {
    running.get(key)?.abort()
    set(key, undefined)
  }
}

/** The stored image `key` uploaded as, once it's ready. */
export const readyRef = (key: number) => {
  const state = outbox.getState().uploads.get(key)
  return state?.status === 'ready' ? state.ref : undefined
}
