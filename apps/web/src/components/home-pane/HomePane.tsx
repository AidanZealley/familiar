import { ChatDotsIcon, ChecksIcon, HashIcon } from '@phosphor-icons/react'
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
import { latestFirst, liveOf, useFamiliars, useRooms } from '@/lib/workspace'
import { WaitingSection } from './components/waiting-section'

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? '' : 's'}`

/**
 * Beside the sidebar on a wide screen, with nothing open: a catch-up. The
 * faces of DMs and rooms with something unread, or a last reply that
 * failed, newest first, each opening its conversation, so they go as
 * they're read; who's answering, under the title. All from the rooms the
 * sidebar already has.
 * A phone has no such pane: its sidebar is home. With no Familiars yet,
 * the cat invites the first.
 */
export const HomePane = () => {
  const familiars = useFamiliars()
  const rooms = useRooms()
  const { open: openDialog } = useDialogs()
  const { waiting, unread, failed, answering } = useMemo(() => {
    const open = rooms.filter((room) => room.kind === 'dm' || !room.archived)
    const failing = (room: (typeof open)[number]) =>
      room.last?.kind === 'reply' && room.last.outcome === 'failed'
    return {
      waiting: latestFirst(
        open.filter((room) => (room.unread ?? 0) > 0 || failing(room)),
        (room) => room.last,
      ),
      unread: open.reduce((sum, room) => sum + (room.unread ?? 0), 0),
      failed: open.filter(failing).length,
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

  const dms = waiting.filter((room) => room.kind === 'dm')
  const named = waiting.filter((room) => room.kind === 'room')
  const counts = [
    unread > 0 && `${unread} unread`,
    failed > 0 && `${failed} failed ${failed === 1 ? 'reply' : 'replies'}`,
  ].filter(Boolean)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Empty className="min-h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {waiting.length ? <ChatDotsIcon /> : <ChecksIcon />}
          </EmptyMedia>
          <EmptyTitle>
            {waiting.length
              ? `${plural(waiting.length, 'conversation')} to catch up on`
              : 'All caught up'}
          </EmptyTitle>
          {counts.length > 0 && (
            <EmptyDescription>{counts.join(' · ')}</EmptyDescription>
          )}
          {answering.length > 0 && (
            <LiveStatus
              live={{ running: answering, queued: [], elsewhere: [] }}
            />
          )}
        </EmptyHeader>
        {waiting.length > 0 && (
          <div className="flex w-full max-w-sm flex-col gap-6 text-left">
            {dms.length > 0 && (
              <WaitingSection
                label="DMs"
                layout="grid"
                rooms={dms}
                familiars={familiars}
              />
            )}
            {named.length > 0 && (
              <WaitingSection
                icon={HashIcon}
                label="Rooms"
                layout="list"
                rooms={named}
                familiars={familiars}
              />
            )}
          </div>
        )}
      </Empty>
    </div>
  )
}
