import type { ConnectionInfo } from '@familiar-ai/client'
import { queryOptions } from '@tanstack/react-query'
import { workspace } from '@/lib/familiar'

const connecting = (connections: ConnectionInfo[] | undefined) =>
  connections?.some(
    (connection) =>
      connection.kind === 'mcp' && connection.status.type === 'connecting',
  )

/**
 * Fetched, not mirrored: servers connect and drop in the background, so the
 * list is polled while it's shown, quickly while one connects so its outcome
 * shows promptly.
 */
export const connectionsQuery = queryOptions({
  queryKey: ['connections'],
  queryFn: () => workspace.connections.list(),
  refetchInterval: (query) => (connecting(query.state.data) ? 1000 : 5000),
})
