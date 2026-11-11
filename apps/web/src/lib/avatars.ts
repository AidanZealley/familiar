import type { FamiliarSummary } from '@familiar-ai/client'

/**
 * Familiars' pixel portraits: 64×32 PNG strips in `public/avatars`, frame 1
 * (mouth closed) then frame 2 (open). They aren't committed until their
 * licence is bought (see the app's README), so each portrait falls back to
 * an initial on a colour when its file is missing.
 */

/** Strips with two identical frames, which can't talk, and 101, whose first frame is 100's. */
const UNUSABLE = new Set([72, 73, 83, 101])
/**
 * The portraits a Familiar can have, as the `avatar` that stores each
 * choice: its strip's number, three digits, such as `042`.
 */
export const PORTRAITS = Array.from({ length: 112 }, (_, index) => index)
  .filter((index) => !UNUSABLE.has(index))
  .map((index) => String(index).padStart(3, '0'))

/** FNV-1a: small, and the same everywhere. */
const hash = (text: string) => {
  let value = 0x811c9dc5
  for (const char of text) {
    value ^= char.codePointAt(0)!
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** The portrait a Familiar gets without a choice: derived from its ID, so it's the same on every device. */
export const derivedPortrait = (familiar: Pick<FamiliarSummary, 'id'>) =>
  PORTRAITS[hash(`familiar:${familiar.id}`) % PORTRAITS.length]!

/**
 * A Familiar's portrait file: its chosen `avatar`, else the one its ID
 * derives. Core keeps the choice without reading it, so one this app
 * doesn't offer counts as none.
 */
export const avatarOf = (familiar: Pick<FamiliarSummary, 'id' | 'avatar'>) => {
  const chosen = familiar.avatar
  const portrait =
    chosen && PORTRAITS.includes(chosen) ? chosen : derivedPortrait(familiar)
  return `/avatars/${portrait}.png`
}

/** The fallback's colour: one of eight hues that sit on either theme. */
export const hueOf = (familiar: Pick<FamiliarSummary, 'id'>) =>
  `var(--familiar-${(hash(`hue:${familiar.id}`) % 8) + 1})`
