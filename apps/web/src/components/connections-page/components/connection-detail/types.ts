import type { ConnectionInfo } from '@familiar-ai/client'

export type ConnectionDetailProps = {
  className?: string
  connection: ConnectionInfo
  onEdit(): void
}
