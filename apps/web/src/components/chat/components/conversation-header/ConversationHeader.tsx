import { useRoom } from '@familiar-ai/client/react'
import { Link } from '@tanstack/react-router'
import { ChevronLeftIcon } from 'lucide-react'
import { useMemo } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { RoomAvatar } from '@/components/room-avatar'
import { Button } from '@/components/ui/button'
import { dialogSearch, pushedState, type DialogRef } from '@/lib/dialogs'
import { titleOf, useFamiliars } from '@/lib/workspace'
import { ConversationMenu } from './components/conversation-menu'
import { ConversationStatus } from './components/conversation-status'
import { liveOf } from './live'
import type { ConversationHeaderProps } from './types'

/**
 * Glass over the conversation, `--chrome` tall: the room's face, name and
 * what's happening in it, which open its settings, and its menu. On a phone,
 * Back returns to the list of conversations.
 */
export const ConversationHeader = ({ room }: ConversationHeaderProps) => {
  const familiars = useFamiliars()
  const items = useRoom((state) => state.transcript?.items)
  const live = useMemo(() => liveOf(items), [items])
  const settings: DialogRef =
    room.kind === 'dm'
      ? { kind: 'familiar', id: room.familiar }
      : { kind: 'room', id: room.id }
  const title = titleOf(room, familiars)
  const dm = room.kind === 'dm' && familiars.find((f) => f.id === room.familiar)

  return (
    <header className="absolute inset-x-0 top-0 z-30 h-(--chrome) border-b border-border/60 bg-background/80 pt-(--status-bar) backdrop-blur-md">
      <div className="flex h-full items-center gap-1 px-2 md:px-4">
        <Button
          variant="ghost"
          size="icon-lg"
          className="md:hidden"
          aria-label="All conversations"
          nativeButton={false}
          render={<Link to="/" />}
        >
          <ChevronLeftIcon />
        </Button>
        <Link
          to="."
          search={dialogSearch(settings)}
          state={(previous) => pushedState(previous)}
          aria-label={`${title} settings`}
          className="group/title flex min-w-0 items-center gap-2.5 py-1 md:-ml-1 md:pl-1"
        >
          {dm ? (
            <PixelAvatar familiar={dm} talking={live.running.includes(dm.id)} />
          ) : room.kind === 'room' ? (
            <RoomAvatar
              members={familiars.filter((f) => room.familiars.includes(f.id))}
            />
          ) : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-heading text-sm font-medium group-hover/title:underline">
              {title}
            </span>
            <ConversationStatus room={room} live={live} />
          </span>
        </Link>
        <ConversationMenu room={room} className="ml-auto" />
      </div>
    </header>
  )
}
