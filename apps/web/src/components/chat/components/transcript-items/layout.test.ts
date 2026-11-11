import type { TranscriptItem } from '@familiar-ai/client'
import { describe, expect, it } from 'vitest'
import { replyRuns } from './layout'

const reply = (
  id: string,
  familiar: number,
  at: number,
  more: Partial<Extract<TranscriptItem, { type: 'reply' }>> = {},
): TranscriptItem => ({
  type: 'reply',
  id,
  familiar,
  at,
  text: '',
  thinking: '',
  toolCalls: [],
  streaming: false,
  stopped: false,
  ...more,
})

const message = (id: string): TranscriptItem => ({
  type: 'message',
  id,
  author: { id: 'me', name: 'Me' },
  text: 'Hi',
  at: 0,
})

describe('replyRuns', () => {
  it('heads each run of one Familiar with the time it finished', () => {
    const runs = replyRuns([
      message('m1'),
      reply('tools', 1, 10),
      reply('answer', 1, 20),
      reply('quiet', 2, 30, { quiet: true }),
      reply('other', 2, 40),
      message('m2'),
      reply('next', 1, 50),
      { type: 'waiting', id: 'w', familiar: 1, status: 'running' },
    ])
    expect([...runs]).toEqual([
      ['tools', { live: false, time: 20 }],
      ['quiet', { live: false, time: 30 }],
      ['other', { live: false, time: 40 }],
      // Its turn is still going, so it has no time yet.
      ['next', { live: true }],
    ])
  })
})
