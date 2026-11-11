import type { ConnectionInfo } from '@familiar-ai/client'

export type ConnectionListProps = {
  /** In the order to show them, most urgent first. */
  connections: ConnectionInfo[]
  query: string
  onQuery(query: string): void
  /** Shows a connection, by `idOf`. */
  onSelect(id: string): void
}
