import type { ConnectionInfo } from '@familiar/client'

export type ConnectionDetailProps = {
  className?: string
  connection: ConnectionInfo
  onEdit(): void
}
