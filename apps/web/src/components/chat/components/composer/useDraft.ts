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

/** Frees what `images` were shown from, once nothing will show them again. */
export const revoke = (images: readonly DraftImage[]) =>
  images.forEach((image) => URL.revokeObjectURL(image.url))

const isEmpty = (draft: Draft) => !draft.text.trim() && !draft.images.length

/**
 * A draft that couldn't be sent put back ahead of what's been drafted
 * since, so neither is lost and every image stays in a draft that frees it.
 * It goes as a note only if both would.
 */
const merged = (unsent: Draft, since: Draft): Draft =>
  isEmpty(since)
    ? unsent
    : {
        text: unsent.text ? `${unsent.text}\n${since.text}` : since.text,
        picked: [
          ...unsent.picked,
          ...since.picked.filter(
            (familiar) => !unsent.picked.some(({ id }) => id === familiar.id),
          ),
        ],
        images: [...unsent.images, ...since.images],
        note: unsent.note && since.note,
      }

const without = (draft: Draft, url: string): Draft => {
  revoke(draft.images.filter((image) => image.url === url))
  return { ...draft, images: draft.images.filter((image) => image.url !== url) }
}

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
    const added = usable.slice(0, Math.max(0, room)).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }))
    setDraft((draft) => ({
      ...draft,
      images: [...draft.images, ...added.map(({ url }) => ({ url }))],
    }))
    for (const { file, url } of added) {
      prepareImage(file).then(
        (prepared) =>
          setDraft((draft) => ({
            ...draft,
            images: draft.images.map((image) =>
              image.url === url ? { ...image, prepared } : image,
            ),
          })),
        () => {
          setDraft((draft) => without(draft, url))
          setRefused("That image couldn't be read.")
        },
      )
    }
  }

  return {
    draft,
    refused,
    /** Something to send: words or images, every image prepared. */
    sendable:
      (!!text.trim() || images.length > 0) &&
      images.every((image) => image.prepared),
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
    remove: (url: string) => setDraft((draft) => without(draft, url)),
    /**
     * The draft to send, its words trimmed, leaving the composer empty. Its
     * images stay shown from their URLs until it's sent or restored.
     */
    take: () => {
      setDraft(empty)
      setRefused(undefined)
      return { ...draft, text: text.trim() }
    },
    /** Puts back a draft that couldn't be sent, keeping any drafted since. */
    restore: (unsent: Draft) => setDraft((draft) => merged(unsent, draft)),
  }
}
