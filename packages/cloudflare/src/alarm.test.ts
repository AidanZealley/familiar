import { DurableObjectSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { expect, test, vi } from 'vitest'
import { alarmTime, alarmWriter } from './alarm.ts'

// The workerd tests in ../test run all of this in workerd. These cover
// what workerd can't be made to do on cue: a write that fails, and writes
// queued behind a commit in progress.

/** The parts of a Durable Object the writer touches, recording what it does. */
function fakeObject(setAlarm: (at: number) => Promise<void>) {
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

test('writes wait for a commit in progress and land in the order asked; a failed one resets the object', async () => {
  const { log, ctx, database, write } = fakeObject(async (at) => {
    if (at === 1) {
      throw new Error('storage reset')
    }
  })
  let finishCommit!: () => void
  const commit = database.transaction(async () => {
    await new Promise<void>((resolve) => (finishCommit = resolve))
    log.push('commit')
  })

  const failed = write(1)
  const writes = [write(null), write(3)]
  await Promise.resolve()
  expect(log).toEqual([])

  finishCommit()
  await expect(failed).rejects.toThrow('storage reset')
  await Promise.all([commit, ...writes])
  expect(ctx.abort).toHaveBeenCalledWith('Alarm write failed')
  expect(log).toEqual(['commit', 'delete', 'set 3'])
})
