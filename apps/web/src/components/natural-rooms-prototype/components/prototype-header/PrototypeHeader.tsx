import { cn } from 'cn'
import { DotsThreeVerticalIcon } from '@phosphor-icons/react'
import { LiveStatus } from '@/components/live-status'
import { PixelAvatar } from '@/components/pixel-avatar'
import { RoomAvatar } from '@/components/room-avatar'
import { Button } from '@/components/ui/button'
import { liveOf, type NamedRoom } from '@/lib/workspace'
import type { PrototypeHeaderProps } from './types'

/**
 * The room's header as ConversationHeader draws it, from fixtures: its
 * portrait, name and LiveStatus line.
 */
export const PrototypeHeader = ({
  title,
  members,
  turns,
  faces,
}: PrototypeHeaderProps) => {
  const roomTurns = turns.map((turn) => ({
    familiar: turn.member.id,
    status: turn.status,
  }))
  const live = liveOf(roomTurns)
  // Only what RoomAvatar reads.
  const room = {
    kind: 'room',
    familiars: members.map((member) => member.id),
    lead: members[0]?.id,
    turns: roomTurns,
  } as unknown as NamedRoom

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4">
      {faces ? (
        <span className="flex gap-1">
          {members.map((member) => (
            <PixelAvatar
              key={member.id}
              familiar={member}
              talking={live.running.includes(member.id)}
              className={cn(
                'transition-opacity',
                !live.running.includes(member.id) && 'opacity-60',
              )}
            />
          ))}
        </span>
      ) : (
        <RoomAvatar room={room} />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-heading text-sm font-medium">
          {title}
        </span>
        <LiveStatus live={live} />
      </span>
      <Button
        variant="ghost"
        size="icon-lg"
        className="ml-auto"
        aria-label="Room settings"
        disabled
      >
        <DotsThreeVerticalIcon />
      </Button>
    </header>
  )
}
