import type { Wake } from '@familiar/core'
import type { DurableObjectSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'

/**
 * When to wake for `wake`: a recovery heartbeat while work can run, never
 * later than the earliest sleep; null when nothing needs a process.
 */
export function alarmTime(
  wake: Wake,
  now: number,
  heartbeatMs: number,
): number | null {
  const heartbeat = wake.active ? now + heartbeatMs : undefined
  if (heartbeat === undefined || wake.at === undefined) {
    return heartbeat ?? wake.at ?? null
  }
  return Math.min(heartbeat, wake.at)
}

/**
 * Writes the object's alarm, or deletes it for null. Writes go through the
 * database queue Pi's commits use, so they land in the order asked and a
 * rolled-back Pi transaction can't take one with it. A failed write resets
 * the object, which arms again when it next starts.
 */
export function alarmWriter(
  ctx: DurableObjectState,
  database: DurableObjectSqliteDatabase,
) {
  return (at: number | null): Promise<void> =>
    database
      .transaction(() =>
        at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at),
      )
      .catch((error: unknown) => {
        ctx.abort('Alarm write failed')
        throw error
      })
}
