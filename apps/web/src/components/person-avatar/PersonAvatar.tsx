import { cn } from 'cn'
import type { PersonAvatarProps } from './types'

/** The person: the initial of what they go by, sized like a Familiar's portrait. */
export const PersonAvatar = ({
  name,
  scale = 1,
  className,
}: PersonAvatarProps) => {
  const size = 32 * scale

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'grid shrink-0 place-items-center bg-secondary font-heading font-medium text-secondary-foreground uppercase',
        className,
      )}
      style={{ width: size, height: size, fontSize: size / 2 }}
    >
      {name.trim().slice(0, 1)}
    </span>
  )
}
