import type { ConversationView } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createLog, type LogState } from './log.ts'
import { view as windowOf } from './testing.ts'

const message = (id: number) => ({
  id,
  conversationId: 1,
  kind: 'familiar.message',
  data: { author: { id: 'sam', name: 'Sam' }, text: `${id}`, at: id },
})
const view = (...ids: number[]) =>
  ({
    ...windowOf(...ids),
    entries: ids.map(message),
  }) as unknown as ConversationView

test('an earlier page settling as a newer view arrives keeps the newer entries', async () => {
  // However many microtasks apart the page and the view land.
  for (let delay = 0; delay < 6; delay++) {
    let respond!: (page: unknown) => void
    const store = createStore<LogState>()(() => ({
      view: undefined,
      turns: undefined,
      transcript: undefined,
    }))
    const log = createLog(
      store.setState,
      store.getState,
      () => new Promise((resolve) => (respond = resolve)) as never,
    )
    store.setState(log.receive(view(3)))
    const loading = log.loadOlder()
    await Promise.resolve()
    respond({ items: [message(2), message(1)] })
    for (let tick = 0; tick < delay; tick++) {
      await Promise.resolve()
    }
    store.setState(log.receive(view(3, 4)))
    await loading
    expect(store.getState().transcript?.items.map((item) => item.id)).toEqual([
      'entry:1',
      'entry:2',
      'entry:3',
      'entry:4',
    ])
  }
})
