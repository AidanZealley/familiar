import type { TranscriptItem } from '@familiar-ai/client'

/** Who has a turn in the open room, from its transcript: answering, queued, or busy in another room. */
export const liveOf = (items: readonly TranscriptItem[] = []) => {
  const live = {
    running: new Set<number>(),
    queued: new Set<number>(),
    elsewhere: new Set<number>(),
  }
  for (const item of items) {
    if (item.type === 'reply' && item.streaming) {
      live.running.add(item.familiar)
    } else if (item.type === 'waiting') {
      live[item.status].add(item.familiar)
    }
  }
  return {
    running: [...live.running],
    queued: [...live.queued],
    elsewhere: [...live.elsewhere],
  }
}
