import type { TranscriptItem } from '@familiar-ai/client'

export type ReplyProps = {
  reply: Extract<TranscriptItem, { type: 'reply' }>
}
