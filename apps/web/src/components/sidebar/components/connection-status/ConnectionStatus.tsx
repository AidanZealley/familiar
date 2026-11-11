import { CatIcon, CircleAlertIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { connectionProblems } from '@/lib/connection-problems'
import { useWorkspace } from '@/lib/familiar'

/** The workspace's connection, in the logo's place so nothing shifts while it reconnects. */
export const ConnectionStatus = () => {
  const connection = useWorkspace((state) => state.connection)

  switch (connection) {
    case 'open':
      return <CatIcon className="size-5" />
    case 'connecting':
      return <Spinner className="size-5" aria-label="Connecting" />
    case 'reconnecting':
      return <Spinner className="size-5" aria-label="Reconnecting" />
    default:
      return (
        <CircleAlertIcon
          role="img"
          className="size-5 text-destructive"
          aria-label={connectionProblems[connection]}
        />
      )
  }
}
