import type { ConnectionInfo } from '@familiar-ai/client'

export type ConnectionDetailProps = {
  connection: ConnectionInfo
  onEdit(): void
  onBack(): void
}
