import {
  summonFamiliar,
  type Familiar,
  type FamiliarEnd,
} from '@familiar-ai/core'
import { expect, test, vi } from 'vitest'
import { DurableFamiliar } from './durable-familiar.ts'

vi.mock('@familiar-ai/core', () => ({ summonFamiliar: vi.fn() }))
vi.mock('@earendil-works/pi-durable/storage/sqlite/cloudflare', () => ({
  openDurableObjectSqliteStorage: async () => ({}),
  DurableObjectSqliteDatabase: class {
    transaction(work: () => Promise<void>) {
      return work()
    }
  },
}))

test('a failed Familiar resets the object with its recovery alarm intact', async () => {
  let end!: (value: FamiliarEnd) => void
  const closed = new Promise<FamiliarEnd>((resolve) => {
    end = resolve
  })
  vi.mocked(summonFamiliar).mockResolvedValue({
    closed,
    wake: () => ({ active: true }),
  } as Familiar)

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
  new DurableFamiliar(ctx, {
    familiar: () => ({}) as Parameters<typeof summonFamiliar>[0],
  })
  await opening
  const recoveryAlarm = alarm
  expect(recoveryAlarm).not.toBeNull()
  end({ reason: 'failed', error: new Error('storage unavailable') })
  await Promise.resolve()
  expect(abort).toHaveBeenCalledWith('Familiar storage failed')
  expect(alarm).toBe(recoveryAlarm)
})
