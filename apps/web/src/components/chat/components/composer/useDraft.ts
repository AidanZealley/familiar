import { IMAGE_LIMITS, type FamiliarSummary } from '@familiar-ai/client'
import { useState } from 'react'
import { isImage, prepareImage } from '@/lib/images'
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

/** Whether `draft` can be sent: words or images, every image prepared. */
export const isSendable = (draft: Draft) =>
  !isEmpty(draft) && draft.images.every((image) => image.prepared)

/** `draft` without the image `id`. */
const without = (draft: Draft, id: number): Draft => ({
  ...draft,
  images: draft.images.filter((image) => image.id !== id),
})

/**
 * The composer's draft, and every change to it: the only writer of what's
 * typed, picked and attached. `refused` says why the last images couldn't
 * be attached, until more are or the draft is taken.
 */
export const useDraft = () => {
  const [draft, setDraft] = useState<Draft>(empty)
  const [refused, setRefused] = useState<string>()
  const { text, images } = draft

  /**
   * Attaches what fits of the images among `files`, each shown at once and
   * sendable once it's prepared, and says why any others weren't, or why
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
    for (const { id, file } of added) {
      prepareImage(file).then(
        (prepared) =>
          setDraft((draft) => ({
            ...draft,
            images: draft.images.map((image) =>
              image.id === id ? { ...image, prepared } : image,
            ),
          })),
        () => {
          setDraft((draft) => without(draft, id))
          setRefused("That image couldn't be read.")
        },
      )
    }
  }

  return {
    draft,
    refused,
    sendable: isSendable(draft),
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
    remove: (id: number) => setDraft((draft) => without(draft, id)),
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
