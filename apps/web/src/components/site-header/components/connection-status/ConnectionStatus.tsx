import { useFamiliar } from '@/lib/familiar'
import { CatIcon, CircleAlertIcon } from 'lucide-react'
import { connectionProblems } from '@/lib/connection-problems'
import { Spinner } from '@/components/ui/spinner'

export const ConnectionStatus = () => {
  const connection = useFamiliar((state) => state.connection)

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
