import type { Connection } from '@familiar-ai/client'

/** Why the connection stopped for good, as the owner reads it. */
export const connectionProblems: Record<
  Exclude<Connection, 'connecting' | 'open' | 'reconnecting'>,
  string
> = {
  outdated: 'Familiar has been updated. Reload to use the latest version.',
  unauthorized: 'Access was refused. Check your connection and reload.',
  failed: 'Could not connect to Familiar. Check your connection and reload.',
}
