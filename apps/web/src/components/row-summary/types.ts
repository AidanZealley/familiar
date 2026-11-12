import type { RoomSummary } from '@familiar-ai/client'
import type { ReactNode } from 'react'

export type RowSummaryProps = {
  title: string
  /** The conversation as the workspace lists it; none for a DM not yet opened. */
  room: RoomSummary | undefined
  /** What to say while there's nothing to preview or no one working. */
  fallback?: ReactNode
  /** Lets the latest entry run to three lines rather than one. */
  wrap?: boolean
}
