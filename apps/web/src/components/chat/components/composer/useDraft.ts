import {
  IMAGE_LIMITS,
  ImageUploadError,
  type FamiliarSummary,
} from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { isImage, refusalOf } from '@/lib/images'
import { forget, outbox, upload } from '@/lib/outbox'
import type { DraftImage } from './components/draft-images'
import { completeMention } from './mentions'

/**
 * What's typed, the Familiars picked from the `@` menu while typing it, the
 * images attached, and whether it goes as a note: context no one replies
 * to, which carries no images.
 */
export type Draft = {
  text: string
  picked: readonly FamiliarSummary[]
  images: readonly DraftImage[]
  note: boolean
}

const empty: Draft = { text: '', picked: [], images: [], note: false }

let lastId = 0
/** A key for an image or a failed send, unique while the page is open. */
export const nextId = () => ++lastId

export const isEmpty = (draft: Draft) =>
  !draft.text.trim() && !draft.images.length

/** `draft` without the image `id`. */
const without = (draft: Draft, id: number): Draft => ({
  ...draft,
  images: draft.images.filter((image) => image.id !== id),
})

/**
 * The composer's draft, and every change to it: the only writer of what's
 * typed, picked and attached. Each image's upload starts as it's attached,
 * in the outbox, under the image's key. `refused` says why the last images
 * couldn't be attached, until more are or the draft is taken.
 */
export const useDraft = () => {
  const store = useRoomStore()
  const [draft, setDraft] = useState<Draft>(empty)
  const [refused, setRefused] = useState<string>()
  const uploads = useStore(outbox, (state) => state.uploads)
  const { text, images } = draft

  /** Uploads `image`; if the daemon refuses it, it's removed, with why. */
  const startUpload = ({ id, file }: DraftImage) =>
    upload(id, file, store.uploadImage).catch((error: unknown) => {
      setDraft((draft) => without(draft, id))
      setRefused(
        error instanceof ImageUploadError && error.code
          ? refusalOf(error.code)
          : "That image couldn't be uploaded.",
      )
    })

  /**
   * Attaches what fits of the images among `files`, each shown at once and
   * sendable once it's uploaded, and says why any others weren't, or why
   * none were: a note carries no images.
   */
  const attach = (files: readonly File[]) => {
    const room = IMAGE_LIMITS.count - images.length
    const usable = files.filter(isImage)
    if (!files.length) {
      return
    }
    if (draft.note) {
      setRefused('A note carries no images.')
      return
    }
    setRefused(
      usable.length > room
        ? `A message takes up to ${IMAGE_LIMITS.count} images.`
        : usable.length < files.length
          ? 'Only images can be attached.'
          : undefined,
    )
    const added = usable
      .slice(0, Math.max(0, room))
      .map((file) => ({ id: nextId(), file }))
    setDraft((draft) => ({ ...draft, images: [...draft.images, ...added] }))
    added.forEach(startUpload)
  }

  return {
    draft,
    refused,
    /** Words or images, and every image uploaded. */
    sendable:
      !isEmpty(draft) &&
      images.every((image) => uploads.get(image.id)?.status === 'ready'),
    type: (text: string) => setDraft((draft) => ({ ...draft, text })),
    /** Completes the `@` being typed as `familiar`'s name. */
    mention: (familiar: FamiliarSummary) =>
      setDraft((draft) => ({
        ...draft,
        text: completeMention(draft.text, familiar),
        picked: [...draft.picked, familiar],
      })),
    /** Starts a mention at the end of what's typed. */
    startMention: () =>
      setDraft((draft) => ({
        ...draft,
        text: `${draft.text}${draft.text && !/\s$/.test(draft.text) ? ' ' : ''}@`,
      })),
    toggleNote: () => setDraft((draft) => ({ ...draft, note: !draft.note })),
    attach,
    /** Tries a failed upload again. */
    retry: (image: DraftImage) => void startUpload(image),
    /** Removes an image, stopping its upload if it's running. */
    remove: (id: number) => {
      forget([id])
      setDraft((draft) => without(draft, id))
    },
    /** The draft to send, its words trimmed, leaving the composer empty. */
    take: () => {
      setDraft(empty)
      setRefused(undefined)
      return { ...draft, text: text.trim() }
    },
    /**
     * Makes `unsent` the draft, to change it before sending. The composer
     * offers this only while the draft is empty, so it's never merged.
     */
    edit: (unsent: Draft) => {
      setDraft(unsent)
      setRefused(undefined)
    },
  }
}
