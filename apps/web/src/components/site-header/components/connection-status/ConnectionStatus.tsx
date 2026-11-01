import { useFamiliar } from '@familiar-ai/client/react'
import { CatIcon, CircleAlertIcon } from 'lucide-react'
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
    default: {
      const labels = {
        outdated: 'Client is outdated. Reload to update.',
        unauthorized: 'Not authorised. Reload to try again.',
        failed: 'Connection failed. Reload to try again.',
      }

      return (
        <CircleAlertIcon
          role="img"
          className="size-5 text-destructive"
          aria-label={labels[connection]}
        />
      )
    }
  }
}
