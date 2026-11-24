import { composeMessage } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import { toParts } from './mentions'
import { revoke, type Draft } from './useDraft'

/**
 * The composer's commands: sending a draft, as a message or a note, and
 * Stop. A draft that fails to send goes back through `restore`, images
 * and all; one that's sent frees its images. `error` is the latest
 * failure of any command sharing the composer's key, the model picker's
 * too, until another succeeds.
 */
export const useSend = (restore: (draft: Draft) => void) => {
  const store = useRoomStore()
  const send = useMutation({
    mutationKey: ['composer'],
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
    onSuccess: (_result, sent) => revoke(sent.images),
    onError: (_error, sent) => restore(sent),
  })
  const stop = useMutation({
    mutationKey: ['composer'],
    mutationFn: () => store.stop(),
  })
  const error = useMutationState({
    filters: { mutationKey: ['composer'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)

  return { send: send.mutate, stop: () => stop.mutate(), error }
}
