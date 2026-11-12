import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { PixelAvatar } from '@/components/pixel-avatar'
import { RoomAvatar } from '@/components/room-avatar'
import { liveOf, titleOf } from '@/lib/workspace'
import type { WaitingFaceProps } from './types'

/**
 * A conversation with something waiting, as its face and name, opening it:
 * how many entries are unread, or `!` in red when its last reply failed,
 * on the face's corner as a tile or after the name as a row. A Familiar
 * replying there talks.
 */
export const WaitingFace = ({ room, familiars, layout }: WaitingFaceProps) => {
  const title = titleOf(room, familiars)
  const failed = room.last?.kind === 'reply' && room.last.outcome === 'failed'
  const unread = room.unread ?? 0
  const talking = liveOf(room.turns).running
  const familiar =
    room.kind === 'dm'
      ? familiars.find((each) => each.id === room.familiar)
      : undefined
  const face =
    room.kind === 'room' ? (
      <RoomAvatar room={room} />
    ) : (
      familiar && (
        <PixelAvatar
          familiar={familiar}
          talking={talking.includes(familiar.id)}
        />
      )
    )
  const count = cn(
    'h-4 min-w-4 px-1 text-center text-[10px] leading-4 tabular-nums',
    failed
      ? 'bg-destructive text-background'
      : 'bg-primary text-primary-foreground',
  )
  const mark = failed ? '!' : unread

  return (
    <Link
      {...(room.kind === 'dm'
        ? { to: '/dm/$familiar', params: { familiar: String(room.familiar) } }
        : { to: '/room/$room', params: { room: String(room.id) } })}
      aria-label={
        failed ? `${title}, a reply failed` : `${title}, ${unread} unread`
      }
      className={cn(
        'group flex outline-offset-2 hover:bg-muted',
        layout === 'tile'
          ? 'w-16 flex-col items-center gap-1.5 p-1'
          : 'items-center gap-2.5 p-1.5',
      )}
    >
      <span className="relative shrink-0">
        {face}
        {layout === 'tile' && (
          <span className={cn(count, 'absolute -top-1.5 -right-2')}>
            {mark}
          </span>
        )}
      </span>
      <span
        className={cn(
          'truncate',
          layout === 'tile' ? 'w-full text-center text-xs' : 'flex-1 text-sm',
        )}
      >
        {title}
      </span>
      {layout === 'row' && (
        <span className={cn(count, 'shrink-0')}>{mark}</span>
      )}
    </Link>
  )
}
