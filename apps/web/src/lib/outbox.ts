import {
  createRequestId,
  ImageUploadError,
  type FamiliarSummary,
  type ImageRef,
  type Mention,
  type RoomState,
  type RoomStore,
} from '@familiar-ai/client'
import { createStore } from 'zustand/vanilla'
import { refusalOf, shrinkForUpload } from './images'

/**
 * The outbox: everything on its way from this page to the daemon, kept for
 * the page's life: it outlives the composer and each room's own store.
 *
 * - `uploads`: each image's upload, by the key of its image. Written only
 *   by `upload` and `forget`.
 * - `sends`: each room's sent messages and notes, oldest first, until the
 *   room shows them. Written only by `send`, its delivery, and the failed
 *   item's `retry`, `take` and `discard`.
 *
 * A send is a small state machine. `uploading` waits for its images, then
 * `posting` posts it with the `requestId` it was given at Send, then
 * `posted` holds the entry it was committed as. Any step can end in
 * `failed`, and only a failed send can be retried (back to `uploading`,
 * with the same `requestId`, so the daemon posts it once), taken back to
 * edit, or discarded. So one delivery runs per send, and nothing else
 * writes it meanwhile.
 *
 * An image's upload belongs to the draft it's attached to until Send, then
 * to the send; `take` hands it back. Whoever drops an image forgets its
 * upload: the draft's owner, `discard`, or `send`, as it clears out sends
 * the room has shown.
 */

/**
 * What's drafted: what's typed, the Familiars picked from the `@` menu
 * while typing it, the images attached, and whether it goes as a note:
 * context no one replies to, which carries no images.
 */
export type Draft = {
  text: string
  picked: readonly FamiliarSummary[]
  images: readonly DraftImage[]
  note: boolean
}

/**
 * An image attached to a draft: shown from its `file`, and uploaded under
 * its `id`, which says in `uploads` how far its upload has got.
 */
export type DraftImage = {
  /** Its identity, as `nextId` gives it, and its upload's key. */
  id: number
  file: File
}

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

/** Where a send is; see the outbox. `error` says why, for the person. */
export type SendPhase =
  | { status: 'uploading' }
  | { status: 'posting' }
  | { status: 'posted'; entry: number }
  | { status: 'failed'; error: string }

/** A message or note on its way to a room. */
export type Send = {
  /** Its identity, as `nextId` gives it. */
  key: number
  /** Fixed at Send: every attempt posts with it. */
  requestId: string
  /** What was sent, to show it and to take it back to edit. */
  draft: Draft
  /** The message `draft` composes, as posted. */
  message: { text: string; mentions?: Mention[] }
  phase: SendPhase
}

/** What a send needs of its room: its store's commands, and its state. */
export type Room = Pick<RoomStore, 'send' | 'note' | 'uploadImage' | 'getState'>

/** Uploads a blob to the open room, as the room store's `uploadImage`. */
export type Uploader = Room['uploadImage']

export const outbox = createStore<{
  uploads: ReadonlyMap<number, UploadState>
  sends: ReadonlyMap<number, readonly Send[]>
}>(() => ({ uploads: new Map(), sends: new Map() }))

let lastId = 0
/** A key for an image or a send, unique while the page is open. */
export const nextId = () => ++lastId

/** The upload keys of `draft`'s images. */
export const keysOf = (draft: Draft) => draft.images.map((image) => image.id)

/** Each running upload's abort and end, by key. Not state: nothing renders it. */
const running = new Map<
  number,
  { controller: AbortController; done: Promise<unknown> }
>()

const setUpload = (key: number, state: UploadState | undefined) =>
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
export function upload(key: number, file: File, uploader: Uploader) {
  const controller = new AbortController()
  // Every write goes through here, so once forgotten, nothing comes back.
  const update = (state: UploadState | undefined) => {
    if (!controller.signal.aborted) {
      setUpload(key, state)
    }
  }
  const run = async () => {
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
  const done = run()
  running.set(key, { controller, done })
  return done
}

/** Stops `keys`' uploads, if they're running, and drops them. */
export function forget(keys: readonly number[]) {
  for (const key of keys) {
    running.get(key)?.controller.abort()
    setUpload(key, undefined)
  }
}

/** Writes `room`'s sends as `change` makes them. */
const setSends = (
  room: number,
  change: (sends: readonly Send[]) => readonly Send[],
) =>
  outbox.setState(({ sends }) => {
    const next = new Map(sends)
    next.set(room, change(sends.get(room) ?? []))
    return { sends: next }
  })

/** Moves send `key` in `room` to `phase`, if it's still there. */
const setPhase = (room: number, key: number, phase: SendPhase) =>
  setSends(room, (sends) =>
    sends.map((send) => (send.key === key ? { ...send, phase } : send)),
  )

/** `room`'s failed send `key`, the only phase anything but delivery changes. */
const failedSend = (room: number, key: number) =>
  outbox
    .getState()
    .sends.get(room)
    ?.find((send) => send.key === key && send.phase.status === 'failed')

/**
 * Waits for `images` to upload, starting any that failed or were refused
 * (the automatic retry), and gives their refs, or why one didn't upload.
 */
async function uploaded(
  images: readonly DraftImage[],
  uploader: Uploader,
): Promise<{ refs: string[] } | { error: string }> {
  let refused: string | undefined
  await Promise.all(
    images.map(({ id, file }) => {
      const state = outbox.getState().uploads.get(id)
      const attempt =
        !state || state.status === 'failed'
          ? upload(id, file, uploader)
          : running.get(id)?.done
      return attempt?.catch((error: unknown) => {
        if (error instanceof ImageUploadError && error.code) {
          refused = refusalOf(error.code)
        }
      })
    }),
  )
  const { uploads } = outbox.getState()
  const refs: string[] = []
  for (const { id } of images) {
    const state = uploads.get(id)
    if (state?.status !== 'ready') {
      return { error: refused ?? "An image couldn't be uploaded." }
    }
    refs.push(state.ref.id)
  }
  return { refs }
}

/** Runs send `key` from `uploading` to `posted` or `failed`. */
async function deliver(room: number, key: number, to: Room) {
  const send = outbox
    .getState()
    .sends.get(room)!
    .find((each) => each.key === key)!
  const { draft, message, requestId } = send
  setPhase(room, key, { status: 'uploading' })
  const images = await uploaded(draft.images, to.uploadImage)
  if ('error' in images) {
    setPhase(room, key, { status: 'failed', error: images.error })
    return
  }
  setPhase(room, key, { status: 'posting' })
  try {
    const { entry } = draft.note
      ? await to.note(message.text, { requestId })
      : await to.send(message.text, {
          mentions: message.mentions,
          images: images.refs,
          requestId,
        })
    setPhase(room, key, { status: 'posted', entry })
  } catch (error) {
    setPhase(room, key, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The newest entry `state`'s room shows, once it shows any. */
export const newestOf = ({ view }: RoomState) =>
  view?.entries.at(-1)?.id ?? view?.before

/**
 * Whether `send` is in the room's transcript, whose newest entry is
 * `newest`: posted, and the room's stream has delivered its entry. Until
 * then it's pending, so it shows in its place with no gap, and from then
 * the entry does, with no duplicate. (C3 in the plan.)
 */
export const isShown = (send: Send, newest: number | undefined) =>
  send.phase.status === 'posted' &&
  newest !== undefined &&
  newest >= send.phase.entry

/**
 * Sends `draft` to `room`, as `message`, once its images are uploaded,
 * however far they've got. It's pending from now until the room shows it.
 * Clears out, with their uploads, the room's sends it already shows.
 */
export function send(
  room: number,
  draft: Draft,
  message: Send['message'],
  to: Room,
) {
  const key = nextId()
  const newest = newestOf(to.getState())
  const shown = (outbox.getState().sends.get(room) ?? []).filter((each) =>
    isShown(each, newest),
  )
  forget(shown.flatMap((each) => keysOf(each.draft)))
  setSends(room, (sends) => [
    ...sends.filter((each) => !shown.includes(each)),
    {
      key,
      requestId: createRequestId(),
      draft,
      message,
      phase: { status: 'uploading' },
    },
  ])
  void deliver(room, key, to)
}

/** Tries failed send `key` again: re-uploads what failed, with its `requestId`. */
export function retry(room: number, key: number, to: Room) {
  if (failedSend(room, key)) {
    void deliver(room, key, to)
  }
}

/** Takes failed send `key` away, keeping its uploads, to edit its draft. */
export function take(room: number, key: number) {
  const send = failedSend(room, key)
  if (send) {
    setSends(room, (sends) => sends.filter((each) => each !== send))
  }
  return send?.draft
}

/** Drops failed send `key`, and its uploads. */
export function discard(room: number, key: number) {
  const draft = take(room, key)
  if (draft) {
    forget(keysOf(draft))
  }
}
