import type { ConnectionInfo } from '@familiar/client'

export type ConnectionListProps = {
  className?: string
  /** In the order to show them, most urgent first. */
  connections: ConnectionInfo[]
  selectedId?: string
  query: string
  onAdd(): void
}
