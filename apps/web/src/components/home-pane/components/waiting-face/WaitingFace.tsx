import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { PixelAvatar } from '@/components/pixel-avatar'
import { RoomAvatar } from '@/components/room-avatar'
import { liveOf, titleOf } from '@/lib/workspace'
import type { WaitingFaceProps } from './types'

/**
 * A conversation with something waiting, as its face and name, opening it:
 * how many entries are unread on its corner, or `!` in red when its last
 * reply failed. A Familiar replying there talks.
 */
export const WaitingFace = ({ room, familiars }: WaitingFaceProps) => {
  const title = titleOf(room, familiars)
  const failed = room.last?.kind === 'reply' && room.last.outcome === 'failed'
  const unread = room.unread ?? 0
  const talking = liveOf(room.turns).running
  const familiar =
    room.kind === 'dm'
      ? familiars.find((each) => each.id === room.familiar)
      : undefined

  return (
    <Link
      {...(room.kind === 'dm'
        ? { to: '/dm/$familiar', params: { familiar: String(room.familiar) } }
        : { to: '/room/$room', params: { room: String(room.id) } })}
      aria-label={
        failed ? `${title}, a reply failed` : `${title}, ${unread} unread`
      }
      className="group flex w-16 flex-col items-center gap-1.5 p-1 outline-offset-2 hover:bg-muted"
    >
      <span className="relative">
        {room.kind === 'room' ? (
          <RoomAvatar room={room} />
        ) : (
          familiar && (
            <PixelAvatar
              familiar={familiar}
              talking={talking.includes(familiar.id)}
            />
          )
        )}
        <span
          aria-hidden
          className={cn(
            'absolute -top-1.5 -right-2 h-4 min-w-4 px-1 text-center text-[10px] leading-4 tabular-nums',
            failed
              ? 'bg-destructive text-background'
              : 'bg-primary text-primary-foreground',
          )}
        >
          {failed ? '!' : unread}
        </span>
      </span>
      <span className="w-full truncate text-center text-xs">{title}</span>
    </Link>
  )
}
