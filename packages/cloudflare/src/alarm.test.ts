import { DurableObjectSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { expect, test, vi } from 'vitest'
import { alarmTime, alarmWriter } from './alarm.ts'

// The Worker tests in apps/cloudflare run all of this in workerd. These cover
// what workerd can't be made to do on cue: a write that fails, and writes
// queued behind a commit in progress.

/** The parts of a Durable Object the writer touches, recording what it does. */
function fakeObject(setAlarm: (at: number) => Promise<void> = async () => {}) {
  const log: string[] = []
  const storage = {
    transaction: <T>(callback: () => Promise<T>) => callback(),
    setAlarm: async (at: number) => {
      await setAlarm(at)
      log.push(`set ${at}`)
    },
    deleteAlarm: async () => {
      log.push('delete')
    },
  }
  const ctx = { storage, abort: vi.fn() }
  const database = new DurableObjectSqliteDatabase(
    storage as unknown as DurableObjectStorage,
  )
  return {
    log,
    ctx,
    database,
    write: alarmWriter(ctx as unknown as DurableObjectState, database),
  }
}

test('the alarm is a heartbeat while work runs, never later than a sleep', () => {
  expect(alarmTime({ active: false }, 1_000, 60)).toBeNull()
  expect(alarmTime({ active: false, at: 5_000 }, 1_000, 60)).toBe(5_000)
  expect(alarmTime({ active: true }, 1_000, 60)).toBe(1_060)
  expect(alarmTime({ active: true, at: 5_000 }, 1_000, 60)).toBe(1_060)
  expect(alarmTime({ active: true, at: 1_010 }, 1_000, 60)).toBe(1_010)
})

test('writes wait for a commit in progress, then land in the order asked', async () => {
  const { log, database, write } = fakeObject()
  let finishCommit!: () => void
  const commit = database.transaction(async () => {
    await new Promise<void>((resolve) => (finishCommit = resolve))
    log.push('commit')
  })

  const writes = [write(1), write(null), write(3)]
  await Promise.resolve()
  expect(log).toEqual([])

  finishCommit()
  await Promise.all([commit, ...writes])
  expect(log).toEqual(['commit', 'set 1', 'delete', 'set 3'])
})

test('a failed write resets the object, and later writes still land', async () => {
  const { log, ctx, write } = fakeObject(async (at) => {
    if (at === 1) {
      throw new Error('storage reset')
    }
  })
  await expect(write(1)).rejects.toThrow('storage reset')
  expect(ctx.abort).toHaveBeenCalledWith('Alarm write failed')
  await write(2)
  expect(log).toEqual(['set 2'])
})
