import type { Tx } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { toolInvoker } from './invoker.ts'

// People, schedules, nesting and name-only history are resolved end to end in
// conversation/authors.test.ts and schedules/schedules.test.ts. Upkeep runs
// only Familiar's own memory tools, so its conversation is checked here.
test('calls in the upkeep conversation, and calls nested in them, run as the system', async () => {
  const tasks = new Map<number, unknown>([
    [
      1,
      {
        kind: 'pi.tool',
        conversationId: 'upkeep',
        input: { kind: 'model', assistant: 7, callId: 'call-1' },
      },
    ],
    [
      2,
      {
        kind: 'pi.tool',
        conversationId: 'upkeep',
        input: { kind: 'nested', parent: 1, parentCallId: 'call-1' },
      },
    ],
  ])
  const tx = {
    task: async (id: number) => tasks.get(id),
    doc: async () => ({ conversation: 'upkeep' }),
  } as unknown as Tx
  expect(await toolInvoker(tx, 1 as never)).toEqual({ kind: 'system' })
  expect(await toolInvoker(tx, 2 as never)).toEqual({ kind: 'system' })
  expect(await toolInvoker(tx, 3 as never)).toEqual({ kind: 'unknown' })
})
