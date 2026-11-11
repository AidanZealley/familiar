import { useRoom } from '@familiar-ai/client/react'
import { ClockIcon, HourglassIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { connectionProblems } from '@/lib/connection-problems'
import { nameOf, setupOf, useFamiliars } from '@/lib/workspace'
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
  const names = (ids: number[]) =>
    ids.map((id) => nameOf(familiars, id)).join(' and ')

  if (connection === 'connecting' || connection === 'reconnecting') {
    return (
      <span className={line} role="status">
        <Spinner className="size-3 shrink-0" />
        Reconnecting…
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
  if (live.running.length) {
    return (
      <span className={`${line} text-primary`}>
        <Spinner className="size-3 shrink-0" />
        <span className="truncate">
          {names(live.running)} {live.running.length > 1 ? 'are' : 'is'}{' '}
          answering
        </span>
      </span>
    )
  }
  if (live.queued.length) {
    return (
      <span className={line}>
        <ClockIcon className="size-3 shrink-0" />
        <span className="truncate">{names(live.queued)} queued</span>
      </span>
    )
  }
  if (live.elsewhere.length) {
    return (
      <span className={line}>
        <HourglassIcon className="size-3 shrink-0" />
        <span className="truncate">
          {names(live.elsewhere)} busy in another room
        </span>
      </span>
    )
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
