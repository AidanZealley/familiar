import type { TranscriptItem } from '@familiar-ai/client'

export type PersonMessageProps = {
  message: Extract<TranscriptItem, { type: 'message' }>
}
