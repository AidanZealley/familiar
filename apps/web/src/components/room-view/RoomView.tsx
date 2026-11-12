import { RoomProvider } from '@familiar-ai/client/react'
import { Chat } from '@/components/chat'
import { HomeLink } from '@/components/home-link'
import { PaneLoader } from '@/components/pane-loader'
import { Problem } from '@/components/problem'
import { FamiliarContext, familiarStreams, roomStreams } from '@/lib/familiar'
import { useStream } from '@/lib/streams'
import { useRoomSummary } from '@/lib/workspace'
import type { RoomViewProps } from './types'

/**
 * The open conversation, with its room's stream, and in a DM its
 * Familiar's, for the model picker. Each room gets a fresh Chat, so a
 * draft or a scroll position never follows you into another.
 */
export const RoomView = ({ id }: RoomViewProps) => {
  const room = useRoomSummary(id)
  const store = useStream(roomStreams, room && id)
  const familiar = useStream(
    familiarStreams,
    room?.kind === 'dm' ? room.familiar : undefined,
  )

  if (!room) {
    return (
      <Problem
        title="There's no such room here"
        description="It may have been removed, or the link is wrong."
        action={<HomeLink />}
      />
    )
  }
  if (!store || (room.kind === 'dm' && !familiar)) {
    return <PaneLoader />
  }
  return (
    <RoomProvider store={store}>
      <FamiliarContext value={familiar}>
        <Chat key={id} room={room} />
      </FamiliarContext>
    </RoomProvider>
  )
}
