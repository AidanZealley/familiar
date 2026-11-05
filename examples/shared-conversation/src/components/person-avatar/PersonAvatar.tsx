import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { PersonAvatarProps } from './types'

// One colour per person, readable in light and dark. None is violet, so no
// person looks like the primary colour.
const COLOURS: Record<string, string> = {
  ana: 'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50',
  ben: 'bg-sky-200 text-sky-950 dark:bg-sky-800 dark:text-sky-50',
  chloe: 'bg-lime-200 text-lime-950 dark:bg-lime-800 dark:text-lime-50',
}

export const PersonAvatar = ({ author }: PersonAvatarProps) => (
  <Avatar size="sm" aria-hidden>
    <AvatarFallback className={COLOURS[author.id]}>
      {author.name[0]}
    </AvatarFallback>
  </Avatar>
)
