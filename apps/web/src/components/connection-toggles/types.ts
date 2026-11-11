import type { ConnectionInfo } from '@familiar-ai/client'
import type { ReactNode } from 'react'

export type ConnectionTogglesProps = {
  /** Undefined while loading. */
  connections: ConnectionInfo[] | undefined
  /** The switch for one connection. */
  toggle(connection: ConnectionInfo): ReactNode
}
