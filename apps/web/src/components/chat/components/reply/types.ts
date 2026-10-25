import type { TranscriptItem } from '@familiar/client'

export type ReplyProps = {
  reply: Extract<TranscriptItem, { type: 'reply' }>
}
