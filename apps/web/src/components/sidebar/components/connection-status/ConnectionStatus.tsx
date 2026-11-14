import { WarningCircleIcon } from '@phosphor-icons/react'
import { PixelCat } from '@/components/pixel-cat'
import { connectionProblems } from '@/lib/connection-problems'
import { useWorkspace } from '@/lib/familiar'
import type { ConnectionStatusProps } from './types'

/**
 * The workspace's connection, as the logo: the cat sits while connected
 * and hops while it connects, so nothing shifts while it reconnects. It
 * hops while connected too when `hopping`.
 */
export const ConnectionStatus = ({
  hopping = false,
}: ConnectionStatusProps) => {
  const connection = useWorkspace((state) => state.connection)

  switch (connection) {
    case 'open':
      return <PixelCat animated={hopping} className="size-4" />
    case 'connecting':
    case 'reconnecting':
      return (
        <span
          role="status"
          className="flex"
          aria-label={
            connection === 'connecting' ? 'Connecting' : 'Reconnecting'
          }
        >
          <PixelCat animated className="size-4" />
        </span>
      )
    default:
      return (
        <WarningCircleIcon
          role="img"
          className="size-5 text-destructive"
          aria-label={connectionProblems[connection]}
        />
      )
  }
}
