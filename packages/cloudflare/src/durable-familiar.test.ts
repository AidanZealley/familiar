import {
  summonFamiliar,
  type Familiar,
  type FamiliarEnd,
} from '@familiar-ai/core'
import { expect, test, vi } from 'vitest'
import { DurableFamiliar } from './durable-familiar.ts'

vi.mock('@familiar-ai/core', () => ({ summonFamiliar: vi.fn() }))
vi.mock('@earendil-works/pi-durable/storage/sqlite', () => ({
  SqliteStorage: { open: async () => ({}) },
}))
vi.mock('@earendil-works/pi-durable/storage/sqlite/cloudflare', () => ({
  DurableObjectSqliteDatabase: class {
    async exec() {}
    async get() {}
    transaction(work: () => Promise<void>) {
      return work()
    }
  },
}))

test('a failed Familiar resets the object with its recovery alarm intact, and a new instance opens again', async () => {
  let end!: (value: FamiliarEnd) => void
  const closed = new Promise<FamiliarEnd>((resolve) => {
    end = resolve
  })
  const wake = () => ({ active: true })
  vi.mocked(summonFamiliar)
    .mockResolvedValueOnce({ closed, wake } as Familiar)
    .mockResolvedValueOnce({ closed: new Promise(() => {}), wake } as Familiar)

  let alarm: number | null = null
  let opening!: Promise<unknown>
  const abort = vi.fn()
  const ctx = {
    storage: {
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
  const options = {
    familiar: () => ({}) as Parameters<typeof summonFamiliar>[0],
  }
  new DurableFamiliar(ctx, options)
  await opening
  const recoveryAlarm = alarm
  expect(recoveryAlarm).not.toBeNull()
  end({ reason: 'failed', error: new Error('storage unavailable') })
  await Promise.resolve()
  expect(abort).toHaveBeenCalledWith('Familiar storage failed')
  expect(alarm).toBe(recoveryAlarm)

  const reopened = new DurableFamiliar(ctx, options)
  await opening
  expect(summonFamiliar).toHaveBeenCalledTimes(2)
  expect((await reopened.status()).status).toBe('open')
})
