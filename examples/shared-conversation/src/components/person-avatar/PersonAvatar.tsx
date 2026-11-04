import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { PersonAvatarProps } from './types'

// Tailwind's palette tints, readable in light and dark. Violet is left out
// so no person looks like the primary colour.
const COLOURS = [
  'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50',
  'bg-sky-200 text-sky-950 dark:bg-sky-800 dark:text-sky-50',
  'bg-lime-200 text-lime-950 dark:bg-lime-800 dark:text-lime-50',
  'bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-50',
  'bg-rose-200 text-rose-950 dark:bg-rose-800 dark:text-rose-50',
  'bg-fuchsia-200 text-fuchsia-950 dark:bg-fuchsia-800 dark:text-fuchsia-50',
]

/** The same colour for a person wherever they appear, from their stable ID. */
const colourOf = (key: string) => {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return COLOURS[hash % COLOURS.length]
}

export const PersonAvatar = ({ author }: PersonAvatarProps) => (
  <Avatar size="sm" aria-hidden>
    <AvatarFallback className={colourOf(author.id)}>
      {author.name[0]}
    </AvatarFallback>
  </Avatar>
)
