import { composeMessage } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import { useState } from 'react'
import { forget, readyRef } from '@/lib/outbox'
import { toParts } from './mentions'
import { nextId, type Draft } from './useDraft'

/** A draft that couldn't be sent, kept as it was sent, with why. */
export type FailedSend = { id: number; draft: Draft; error: string }

/** The upload keys of `draft`'s images. */
export const keysOf = (draft: Draft) => draft.images.map((image) => image.id)

/**
 * The composer's commands: sending a draft, as a message or a note, and
 * Stop; and the only writer of `failed`, the sends that failed, oldest
 * first, each kept until it's retried, taken to edit or discarded. They're
 * the composer's, so lost with it, as its draft is, when the room changes
 * or the page reloads. A sent or discarded draft's uploads are forgotten;
 * a failed one keeps them, uploaded, to send again. `error` is the latest failure of the other commands
 * sharing the composer's key, the model picker's too, until one succeeds.
 */
export const useSend = () => {
  const store = useRoomStore()
  const [failed, setFailed] = useState<readonly FailedSend[]>([])
  const drop = (id: number) =>
    setFailed((failed) => failed.filter((each) => each.id !== id))
  const discard = (failed: FailedSend) => {
    forget(keysOf(failed.draft))
    drop(failed.id)
  }
  const send = useMutation({
    mutationKey: ['send'],
    // While busy this queues; it's answered after the current replies.
    mutationFn: ({ text, picked, note, images }: Draft) => {
      if (note) {
        return store.note(text)
      }
      const message = composeMessage(toParts(text, picked))
      return store.send(message.text, {
        mentions: message.mentions,
        // Sendable only once every image is uploaded.
        images: images.map((image) => readyRef(image.id)!.id),
      })
    },
    onSuccess: (_, draft) => forget(keysOf(draft)),
    onError: (error, draft) =>
      setFailed((failed) => [
        ...failed,
        { id: nextId(), draft, error: error.message },
      ]),
  })
  const stop = useMutation({
    mutationKey: ['composer'],
    mutationFn: () => store.stop(),
  })
  const error = useMutationState({
    filters: { mutationKey: ['composer'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)

  return {
    send: send.mutate,
    stop: () => stop.mutate(),
    error,
    failed,
    /** Sends exactly what failed again, as the same kind. */
    retry: ({ id, draft }: FailedSend) => {
      drop(id)
      send.mutate(draft)
    },
    discard,
    /** Takes a failed send away, keeping its uploads, to edit it. */
    take: (failed: FailedSend) => {
      drop(failed.id)
      return failed.draft
    },
  }
}
