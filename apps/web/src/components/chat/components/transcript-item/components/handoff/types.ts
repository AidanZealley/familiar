import type { TranscriptItem } from '@familiar-ai/client'

export type HandoffProps = {
  handoff: Extract<TranscriptItem, { type: 'handoff' }>
}
