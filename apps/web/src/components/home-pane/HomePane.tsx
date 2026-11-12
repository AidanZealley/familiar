import { ChatDotsIcon, ChecksIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { LiveStatus } from '@/components/live-status'
import { PixelCat } from '@/components/pixel-cat'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useDialogs } from '@/lib/dialogs'
import { liveOf, useFamiliars, useRooms } from '@/lib/workspace'

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? '' : 's'}`

/**
 * Beside the sidebar on a wide screen, with nothing open: the workspace at
 * a glance, what's unread and who's answering, from the rooms the sidebar
 * already has. With no Familiars yet, the cat invites the first.
 */
export const HomePane = () => {
  const familiars = useFamiliars()
  const rooms = useRooms()
  const { open: openDialog } = useDialogs()
  const { unread, conversations, answering } = useMemo(() => {
    const open = rooms.filter((room) => room.kind === 'dm' || !room.archived)
    const waiting = open.filter((room) => (room.unread ?? 0) > 0)
    return {
      unread: waiting.reduce((sum, room) => sum + (room.unread ?? 0), 0),
      conversations: waiting.length,
      // Only who's answering: being busy elsewhere means nothing here.
      answering: liveOf(open.flatMap((room) => room.turns)).running,
    }
  }, [rooms])

  if (!familiars.length) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia>
            <PixelCat className="size-12" />
          </EmptyMedia>
          <EmptyTitle>Make your first Familiar</EmptyTitle>
          <EmptyDescription>
            Each has its own persona, tools and memory.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => openDialog({ kind: 'new-familiar' })}>
            New Familiar
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {unread ? <ChatDotsIcon /> : <ChecksIcon />}
        </EmptyMedia>
        <EmptyTitle>
          {unread
            ? `${plural(unread, 'unread')} in ${plural(conversations, 'conversation')}`
            : 'All caught up'}
        </EmptyTitle>
        {answering.length > 0 && (
          <LiveStatus
            live={{ running: answering, queued: [], elsewhere: [] }}
          />
        )}
      </EmptyHeader>
    </Empty>
  )
}
