import {
  defineDocFamily,
  type EntryId,
  type TaskId,
} from '@earendil-works/pi-durable'
import { addDays, hourOn, localDay } from '../../time.ts'

/** Passes run daily at this hour, in Familiar's time zone. */
const UPKEEP_HOUR = 4

/**
 * The day a time belongs to. Upkeep days run from 04:00 to 04:00 on the
 * wall clock, so a chat at 1am counts as the night before, as people think
 * of it, and a day with a clock change is 23 or 25 hours long.
 */
export function upkeepDay(at: number, timeZone: string) {
  const day = localDay(at, timeZone)
  return at < hourOn(day, UPKEEP_HOUR, timeZone) ? addDays(day, -1) : day
}

/** The first upkeep time after `now`. */
export function nextUpkeep(now: number, timeZone: string) {
  const today = localDay(now, timeZone)
  const next = hourOn(today, UPKEEP_HOUR, timeZone)
  return next > now ? next : hourOn(addDays(today, 1), UPKEEP_HOUR, timeZone)
}

export type UpkeepState = {
  /** The one task that schedules passes. */
  task: TaskId | null
  /** The newest chat entry a pass has reviewed. */
  through: EntryId | null
}

/**
 * How a Familiar finds its memory upkeep again after a restart. Its
 * conversations are in the Familiar's registry record, with its others.
 */
export const Upkeep = defineDocFamily<UpkeepState, null>({
  kind: 'familiar.upkeep',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ task: null, through: null }),
  checkpointWhen: () => true, // tiny: always store it whole
})
