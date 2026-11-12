import type { FamiliarSummary } from '@familiar-ai/client'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { colourOf } from './characters'

/**
 * A Familiar's portrait, read from the `avatar` string it stores (core
 * keeps it without reading it):
 *
 * - none: the character its ID generates, in its own colour: the default
 * - `initial`: its initial on its colour
 * - `pixel:<shape>:<colour>`: a generated character's shape and colour,
 *   chosen apart; `pixel:<shape>` takes the shape's own colour
 * - anything else: the owner's image of that name
 *
 * An image that isn't there, or a value this app doesn't know, counts as
 * none, so a Familiar always has a portrait.
 */
export type Portrait =
  | { kind: 'initial' }
  | { kind: 'character'; shape: number; colour: number }
  | { kind: 'image'; name: string }

export const INITIAL = 'initial'
/** A chosen character, or null when it's the one the ID gives anyway. */
export const characterAvatar = (
  familiar: Pick<FamiliarSummary, 'id'>,
  shape: number,
  colour: number,
) =>
  shape === familiar.id && colour === colourOf(familiar.id)
    ? null
    : `pixel:${shape}:${colour}`

const CHARACTER = /^pixel:(\d{1,9})(?::(\d))?$/

export const portraitOf = (
  familiar: Pick<FamiliarSummary, 'id' | 'avatar'>,
  images: readonly string[],
): Portrait => {
  const { avatar } = familiar
  if (avatar === INITIAL) {
    return { kind: 'initial' }
  }
  const character = CHARACTER.exec(avatar ?? '')
  if (character) {
    const shape = Number(character[1])
    const colour = character[2] ? Number(character[2]) : colourOf(shape)
    return { kind: 'character', shape, colour }
  }
  if (avatar && images.includes(avatar)) {
    return { kind: 'image', name: avatar }
  }
  return {
    kind: 'character',
    shape: familiar.id,
    colour: colourOf(familiar.id),
  }
}

/**
 * The owner's own portraits, which the daemon serves from the `avatars`
 * folder in its data directory: 64×32 PNG strips, frame 1 (mouth closed)
 * then frame 2 (open), each named by its file. `folder` says where, for
 * the owner to add more; it's missing where nothing serves them.
 */
export type PortraitImages = { folder?: string; names: string[] }

export const portraitImagesQuery = queryOptions({
  queryKey: ['portrait-images'],
  queryFn: async (): Promise<PortraitImages> => {
    const response = await fetch('/api/avatars')
    if (!response.ok) {
      return { names: [] }
    }
    const images = (await response.json()) as PortraitImages
    // `initial` names the initial, not an image.
    return { ...images, names: images.names.filter((name) => name !== INITIAL) }
  },
  // The folder rarely changes; reopening the app picks up a change.
  staleTime: Infinity,
})

const none: PortraitImages = { names: [] }
export const usePortraitImages = () =>
  useQuery(portraitImagesQuery).data ?? none

export const imageUrl = (name: string) => `/api/avatars/${name}.png`

/** FNV-1a: small, and the same everywhere. */
const hash = (text: string) => {
  let value = 0x811c9dc5
  for (const char of text) {
    value ^= char.codePointAt(0)!
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** The initial's colour: one of eight hues that sit on either theme. */
export const hueOf = (familiar: Pick<FamiliarSummary, 'id'>) =>
  `var(--familiar-${(hash(`hue:${familiar.id}`) % 8) + 1})`
