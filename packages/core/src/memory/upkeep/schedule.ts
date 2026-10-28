import {
  defineDoc,
  type ConversationId,
  type EntryId,
  type TaskId,
} from '@earendil-works/pi-durable'
import { localDay } from '../../time/index.ts'

/** Passes run daily at this hour, in the host's time zone. */
const UPKEEP_HOUR = 4

/**
 * The day a time belongs to. Upkeep days run from 04:00 to 04:00, so a chat
 * at 1am counts as the night before, as people think of it.
 */
export const upkeepDay = (at: number) =>
  localDay(at - UPKEEP_HOUR * 60 * 60 * 1000)

/** The first upkeep time after `now`. */
export function nextUpkeep(now: number) {
  const next = new Date(now)
  next.setHours(UPKEEP_HOUR, 0, 0, 0)
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

export type UpkeepState = {
  /** Where passes run: a conversation of its own, never shown to people. */
  conversation: ConversationId | null
  /** Where rollups are written: no tools, so summarising can't change facts. */
  rollups: ConversationId | null
  /** The one task that schedules passes. */
  task: TaskId | null
  /** The newest main-conversation entry a pass has reviewed. */
  through: EntryId | null
}

/** How Familiar finds its memory upkeep again after a restart. */
export const Upkeep = defineDoc<UpkeepState>({
  kind: 'familiar.upkeep',
  version: 2,
  scope: 'session',
  initial: () => ({
    conversation: null,
    rollups: null,
    task: null,
    through: null,
  }),
  migrate: (value, fromVersion) => {
    if (fromVersion !== 1) {
      throw new Error(`No migration from upkeep version ${fromVersion}.`)
    }
    return { ...(value as Omit<UpkeepState, 'rollups'>), rollups: null }
  },
  checkpointWhen: () => true, // tiny: always store it whole
})
