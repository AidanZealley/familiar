import { useRoom } from '@familiar-ai/client/react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { connectionProblems } from '@/lib/connection-problems'
import { nameOf, setupOf, useFamiliars } from '@/lib/workspace'
import type { ConversationStatusProps } from './types'

const line = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'
const list = new Intl.ListFormat('en')

/**
 * Under the room's name, show connection problems or the room's setup
 * alongside who's queued or busy elsewhere.
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
  const setup =
    room.kind === 'room' ? (room.archived ? 'Archived' : setupOf(room)) : null
  const busyStatus = busy.length
    ? `${list.format(busy.map((id) => nameOf(familiars, id)))} ${busy.length === 1 ? 'is' : 'are'} busy`
    : null

  if (!setup && !busyStatus) {
    return null
  }

  return (
    <span className={line} title={busyStatus ?? undefined}>
      {setup && <span className="shrink-0">{setup}</span>}
      {setup && busyStatus && <span aria-hidden="true">·</span>}
      {busyStatus && (
        <span className="flex min-w-0 items-center gap-1.5">
          <HourglassSpinner />
          <span className="truncate">{busyStatus}</span>
        </span>
      )}
    </span>
  )
}
