import type { TranscriptItem } from '@familiar/client'

/** What sits in the margin beside an item. */
export type Margin = {
  /** When it happened, in ms since the epoch. */
  at?: number
}

/**
 * Margins for a transcript: a message's time beside it, and a turn's time
 * beside its last reply. A turn often takes several replies, one calling
 * tools and one answering, so the time goes beside the answer instead of
 * each step. A turn still being answered has none.
 */
export const marginsOf = (items: readonly TranscriptItem[]) => {
  const margins = new Map<string, Margin>()
  let turn: Extract<TranscriptItem, { type: 'reply' }>[] = []
  const close = () => {
    const last = turn.at(-1)
    if (last && !last.streaming) {
      margins.set(last.id, { at: last.at })
    }
    turn = []
  }
  for (const item of items) {
    if (item.type === 'reply') {
      turn.push(item)
      continue
    }
    close()
    if (item.type === 'message') {
      margins.set(item.id, { at: item.at })
    }
  }
  close()
  return margins
}
