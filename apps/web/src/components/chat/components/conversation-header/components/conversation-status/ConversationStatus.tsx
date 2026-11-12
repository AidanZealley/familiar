import { useRoom } from '@familiar-ai/client/react'
import { LiveStatus } from '@/components/live-status'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { connectionProblems } from '@/lib/connection-problems'
import { setupOf, useFamiliars } from '@/lib/workspace'
import type { ConversationStatusProps } from './types'

const line = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

/**
 * Under the room's name, the most pressing of: the room's own connection,
 * who's answering, queued or busy elsewhere, then a named room's setup.
 * A DM says nothing more while idle: its composer names the model.
 */
export const ConversationStatus = ({ room, live }: ConversationStatusProps) => {
  const familiars = useFamiliars()
  const connection = useRoom((state) => state.connection)

  if (connection === 'connecting' || connection === 'reconnecting') {
    return (
      <span className={line} role="status">
        <HourglassSpinner />
        Reconnecting
      </span>
    )
  }
  if (connection !== 'open') {
    return (
      <span className={`${line} text-destructive`} role="alert">
        <span className="truncate">{connectionProblems[connection]}</span>
      </span>
    )
  }
  if (room.turns.length) {
    return <LiveStatus live={live} />
  }
  if (room.kind === 'room') {
    return (
      <span className={line}>
        <span className="truncate">
          {room.archived ? 'Archived' : setupOf(room, familiars)}
        </span>
      </span>
    )
  }
  return null
}
