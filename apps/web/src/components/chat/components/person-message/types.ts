import type { TranscriptItem } from '@familiar/client'

export type PersonMessageProps = {
  message: Extract<TranscriptItem, { type: 'message' }>
}
