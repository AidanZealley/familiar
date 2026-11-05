import type { TranscriptItem } from '@familiar-ai/client'

/**
 * When each turn was answered, by its last reply's ID. A turn often takes
 * several replies, one calling tools and one answering, so the time goes
 * under the answer instead of each step. A turn still being answered has none.
 */
export const turnTimes = (items: readonly TranscriptItem[]) => {
  const times = new Map<string, number>()
  let last: Extract<TranscriptItem, { type: 'reply' }> | undefined
  const close = () => {
    if (last && !last.streaming) {
      times.set(last.id, last.at)
    }
    last = undefined
  }
  for (const item of items) {
    if (item.type === 'waiting') {
      last = undefined
    } else if (item.type === 'reply') {
      last = item
    } else {
      close()
    }
  }
  close()
  return times
}
