import type { ConnectionInfo } from '@familiar-ai/client'

export type ConnectionRowProps = {
  connection: ConnectionInfo
  /** Tool names that match the search. */
  tools: string[]
  selected: boolean
}
