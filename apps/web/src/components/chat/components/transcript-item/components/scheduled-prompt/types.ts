import type { TranscriptItem } from '@familiar-ai/client'

export type ScheduledPromptProps = {
  item: Extract<TranscriptItem, { type: 'scheduled' }>
}
