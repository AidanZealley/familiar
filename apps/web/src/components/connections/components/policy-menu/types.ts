import type { ConnectionInfo, Policy } from '@familiar-ai/client'

export type PolicyMenuProps = {
  connection: ConnectionInfo
  /** A tool's name in the connection; without one, the connection's choice for all its tools. */
  tool?: string
  /** The owner's choice, if any. */
  policy: Policy | undefined
  /** What applies without it; without one, each tool goes by its own hints. */
  fallback?: Policy
}
