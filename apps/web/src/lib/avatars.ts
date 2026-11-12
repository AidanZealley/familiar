import type { FamiliarSummary } from '@familiar-ai/client'
import { queryOptions, useQuery } from '@tanstack/react-query'

/**
 * The owner's portraits for their Familiars, which the daemon serves from
 * the `avatars` folder in its data directory: 64×32 PNG strips, frame 1
 * (mouth closed) then frame 2 (open). Each is named by its file, which a
 * Familiar's `avatar` stores. Without any, every Familiar shows its
 * initial on its colour.
 */
export const portraitsQuery = queryOptions({
  queryKey: ['portraits'],
  queryFn: async () => {
    const response = await fetch('/api/avatars')
    return response.ok ? ((await response.json()) as string[]) : []
  },
  // The folder rarely changes; reopening the app picks up a change.
  staleTime: Infinity,
})

/** The portraits a Familiar can have; none until they've loaded, or without any. */
export const usePortraits = () => useQuery(portraitsQuery).data ?? []

/** FNV-1a: small, and the same everywhere. */
const hash = (text: string) => {
  let value = 0x811c9dc5
  for (const char of text) {
    value ^= char.codePointAt(0)!
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/**
 * A Familiar's portrait's URL: its chosen `avatar`, else one its ID picks,
 * the same on every device; none without portraits. Core keeps the choice
 * without reading it, so one that isn't among them counts as none.
 */
export const avatarOf = (
  familiar: Pick<FamiliarSummary, 'id' | 'avatar'>,
  portraits: string[],
) => {
  const portrait =
    familiar.avatar && portraits.includes(familiar.avatar)
      ? familiar.avatar
      : portraits[hash(`familiar:${familiar.id}`) % portraits.length]
  return portrait && `/api/avatars/${portrait}.png`
}

/** The fallback's colour: one of eight hues that sit on either theme. */
export const hueOf = (familiar: Pick<FamiliarSummary, 'id'>) =>
  `var(--familiar-${(hash(`hue:${familiar.id}`) % 8) + 1})`
