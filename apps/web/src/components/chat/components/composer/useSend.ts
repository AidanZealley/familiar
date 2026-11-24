import { composeMessage, RequestError } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import { useState } from 'react'
import { toParts } from './mentions'
import { nextId, without, type Draft } from './useDraft'

/**
 * A draft that couldn't be sent, kept as it was sent apart from the draft,
 * with why: the image core refused marked with its problem, or `error`, why
 * anything else failed.
 */
export type FailedSend = { id: number; draft: Draft; error?: string }

/** `sent` with the image `error` names marked, or with `error`'s message. */
const failure = (sent: Draft, error: Error): FailedSend => {
  const image = error instanceof RequestError ? error.image : undefined
  return image
    ? {
        id: nextId(),
        draft: {
          ...sent,
          images: sent.images.map((each, index) =>
            index === image.index ? { ...each, problem: image.problem } : each,
          ),
        },
      }
    : { id: nextId(), draft: sent, error: error.message }
}

/**
 * The composer's commands: sending a draft, as a message or a note, and
 * Stop; and the only writer of `failed`, the sends that failed, oldest
 * first, each kept until it's retried, taken to edit or discarded. They're
 * the composer's, so lost with it, as its draft is, when the room changes
 * or the page reloads. `error` is the latest failure of the other commands
 * sharing the composer's key, the model picker's too, until one succeeds.
 */
export const useSend = () => {
  const store = useRoomStore()
  const [failed, setFailed] = useState<readonly FailedSend[]>([])
  const drop = (id: number) =>
    setFailed((failed) => failed.filter((each) => each.id !== id))
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
        images: images.map((image) => image.prepared!),
      })
    },
    onError: (error, sent) =>
      setFailed((failed) => [...failed, failure(sent, error)]),
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
    discard: drop,
    /** Takes the image `image` out of the failed send `id`. */
    removeImage: (id: number, image: number) =>
      setFailed((failed) =>
        failed.map((each) =>
          each.id === id
            ? { ...each, draft: without(each.draft, image) }
            : each,
        ),
      ),
  }
}
