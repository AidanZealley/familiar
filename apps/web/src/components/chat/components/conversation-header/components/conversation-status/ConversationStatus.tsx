import { useRoom } from '@familiar-ai/client/react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { connectionProblems } from '@/lib/connection-problems'
import { nameOf, setupOf, useFamiliars } from '@/lib/workspace'
import type { ConversationStatusProps } from './types'

const line = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

/**
 * Under the room's name, the most pressing of: the room's own connection,
 * who's queued or busy elsewhere, then a named room's setup.
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
  const busy = [...live.elsewhere, ...live.queued]
  if (busy.length) {
    const names = new Intl.ListFormat('en').format(
      busy.map((id) => nameOf(familiars, id)),
    )
    return (
      <span className={line} title={`${names} busy`}>
        <HourglassSpinner />
        <span className="truncate">{names} busy</span>
      </span>
    )
  }
  if (room.kind === 'room') {
    return (
      <span className={line}>
        <span className="truncate">
          {room.archived ? 'Archived' : setupOf(room)}
        </span>
      </span>
    )
  }
  return null
}
