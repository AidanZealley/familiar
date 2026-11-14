import { Link } from '@tanstack/react-router'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { PixelAvatar } from '@/components/pixel-avatar'
import type { ReplyingFaceProps } from './types'

/**
 * A Familiar replying, as a tile beside the DMs waiting: its face talking,
 * the hourglass that marks work in progress elsewhere on its corner,
 * opening the conversation it's replying in.
 */
export const ReplyingFace = ({ familiar, room }: ReplyingFaceProps) => (
  <Link
    {...(room.kind === 'dm'
      ? { to: '/dm/$familiar', params: { familiar: String(room.familiar) } }
      : { to: '/room/$room', params: { room: String(room.id) } })}
    aria-label={
      room.kind === 'dm'
        ? `${familiar.name}, replying`
        : `${familiar.name}, replying in ${room.name}`
    }
    className="flex w-16 flex-col items-center gap-1.5 p-1 outline-offset-2 hover:bg-muted"
  >
    <span className="relative shrink-0">
      <PixelAvatar familiar={familiar} talking />
      <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center bg-primary px-0.5 text-primary-foreground">
        <HourglassSpinner />
      </span>
    </span>
    <span className="w-full truncate text-center text-xs">{familiar.name}</span>
  </Link>
)
