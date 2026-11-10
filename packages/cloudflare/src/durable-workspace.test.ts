import {
  openWorkspace,
  type FamiliarEnd,
  type Workspace,
} from '@familiar-ai/core'
import { expect, test, vi } from 'vitest'
import { DurableWorkspace } from './durable-workspace.ts'

vi.mock('@familiar-ai/core', () => ({ openWorkspace: vi.fn() }))
vi.mock('@earendil-works/pi-durable/storage/sqlite/cloudflare', () => ({
  openDurableObjectSqliteStorage: async () => ({}),
  DurableObjectSqliteDatabase: class {
    transaction(work: () => Promise<void>) {
      return work()
    }
  },
}))

test('a failed workspace resets the object with its recovery alarm intact', async () => {
  let end!: (value: FamiliarEnd) => void
  const closed = new Promise<FamiliarEnd>((resolve) => {
    end = resolve
  })
  vi.mocked(openWorkspace).mockResolvedValue({
    closed,
    wake: () => ({ active: true }),
  } as Workspace)

  let alarm: number | null = null
  let opening!: Promise<unknown>
  const abort = vi.fn()
  const ctx = {
    storage: {
      kv: { get: () => undefined },
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => {
        alarm = at
      },
      deleteAlarm: async () => {
        alarm = null
      },
    },
    blockConcurrencyWhile: (work: () => Promise<unknown>) => {
      opening = work()
      return opening
    },
    abort,
  } as unknown as DurableObjectState
  new DurableWorkspace(ctx, {
    workspace: () => ({}) as Parameters<typeof openWorkspace>[0],
  })
  await opening
  const recoveryAlarm = alarm
  expect(recoveryAlarm).not.toBeNull()
  end({ reason: 'failed', error: new Error('storage unavailable') })
  await Promise.resolve()
  expect(abort).toHaveBeenCalledWith('Workspace storage failed')
  expect(alarm).toBe(recoveryAlarm)
})
