import type { TranscriptItem } from '@familiar-ai/client'

export type ToolRunProps = {
  run: Extract<TranscriptItem, { type: 'tool-run' }>
}
