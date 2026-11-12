import { Link } from '@tanstack/react-router'
import { CaretLeftIcon, DotsThreeVerticalIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { RoomAvatar } from '@/components/room-avatar'
import { Button } from '@/components/ui/button'
import { openDialog, type DialogRef } from '@/lib/dialogs'
import { liveOf, titleOf, useFamiliars } from '@/lib/workspace'
import { ConversationStatus } from './components/conversation-status'
import type { ConversationHeaderProps } from './types'

/**
 * Glass over the conversation, `--chrome` tall: the room's face, name and
 * what's happening in it, which open its settings, as does the ⋮
 * button. On a phone,
 * Back returns to the list of conversations.
 */
export const ConversationHeader = ({ room }: ConversationHeaderProps) => {
  const familiars = useFamiliars()
  // From the workspace's stream, as the sidebar shows it.
  const live = useMemo(() => liveOf(room.turns), [room.turns])
  const settings: DialogRef =
    room.kind === 'dm'
      ? { kind: 'familiar', id: room.familiar }
      : { kind: 'room', id: room.id }
  const title = titleOf(room, familiars)
  const dm = room.kind === 'dm' && familiars.find((f) => f.id === room.familiar)

  return (
    <header className="absolute inset-x-0 top-0 z-30 h-(--chrome) border-b border-border/60 bg-background/80 pt-(--status-bar) backdrop-blur-md">
      {/* The title is inside the button that opens settings; this names
          the conversation for screen readers' heading navigation. */}
      <h2 className="sr-only">{title}</h2>
      <div className="flex h-full items-center gap-1 px-2 md:px-4">
        <Button
          variant="ghost"
          size="icon-lg"
          className="md:hidden"
          aria-label="All conversations"
          nativeButton={false}
          render={<Link to="/" />}
        >
          <CaretLeftIcon />
        </Button>
        <button
          type="button"
          onClick={() => openDialog(settings)}
          aria-label={`${title} settings`}
          className="group/title flex min-w-0 items-center gap-2.5 py-1 text-left md:-ml-1 md:pl-1"
        >
          {dm ? (
            <PixelAvatar familiar={dm} talking={live.running.includes(dm.id)} />
          ) : room.kind === 'room' ? (
            <RoomAvatar room={room} />
          ) : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-heading text-sm font-medium group-hover/title:underline">
              {title}
            </span>
            <ConversationStatus room={room} live={live} />
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="ml-auto"
          aria-label={`${title} settings`}
          onClick={() => openDialog(settings)}
        >
          <DotsThreeVerticalIcon />
        </Button>
      </div>
    </header>
  )
}
