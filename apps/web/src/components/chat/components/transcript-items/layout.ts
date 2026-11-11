import type { TranscriptItem } from '@familiar-ai/client'
// Relative, so the test runner finds it without the app's `@` alias.
import { formatRelativeDay } from '../../../../lib/format'

/** The first item of a run of one Familiar's replies, and how the run stands. */
export type RunHead = {
  /** When the run's last reply was written, once the run has finished. */
  time?: number
  /** Its Familiar is answering now, so its portrait talks. */
  live: boolean
}

type Turn = Extract<TranscriptItem, { type: 'reply' | 'waiting' }>

const quiet = (item: Turn) => item.type === 'reply' && item.quiet === true

/**
 * Each run of one Familiar's turn items in a row, by its first item's ID. A
 * turn often takes several replies, one calling tools and one answering, so
 * the portrait, name and time show once, at the top of the run, with the time
 * the run finished. A Familiar staying quiet is a run of its own.
 */
export const replyRuns = (items: readonly TranscriptItem[]) => {
  const heads = new Map<string, RunHead>()
  let head: Turn | undefined
  let last: Turn | undefined
  const close = () => {
    if (head && last) {
      heads.set(head.id, {
        live:
          last.type === 'waiting' ? last.status === 'running' : last.streaming,
        ...(last.type === 'reply' &&
          !last.streaming &&
          last.at !== undefined && { time: last.at }),
      })
    }
    head = last = undefined
  }
  for (const item of items) {
    if (item.type !== 'reply' && item.type !== 'waiting') {
      close()
    } else if (
      last &&
      last.familiar === item.familiar &&
      quiet(last) === quiet(item)
    ) {
      last = item
    } else {
      close()
      head = last = item
    }
  }
  close()
  return heads
}

const timeOf = (item: TranscriptItem) =>
  item.type === 'scheduled'
    ? item.due
    : item.type === 'waiting'
      ? undefined
      : item.at

/** Items that start a new day, with the day: `Today`, or `Tue 7 Jan`. */
export const dayStarts = (items: readonly TranscriptItem[]) => {
  const starts = new Map<string, string>()
  let previous: string | undefined
  for (const item of items) {
    const time = timeOf(item)
    if (time === undefined) {
      continue
    }
    const day = formatRelativeDay(time)
    if (day !== previous) {
      starts.set(item.id, day)
    }
    previous = day
  }
  return starts
}
