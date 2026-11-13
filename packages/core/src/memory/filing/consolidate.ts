import type { RoomRegistry } from '../../rooms/rooms.ts'
import {
  clipText,
  isCurrent,
  LIMITS,
  normalized,
  standingOf,
  type Note,
  type PageState,
  type Subject,
} from '../store.ts'
import { describeNote } from './batch.ts'
import type { TidyArgs } from './tools.ts'

/**
 * Consolidation, nightly: repair every page by plain rules, then have the
 * memory model tidy each page that changed and rewrite its profile. The
 * profile is where hindsight lives; because it is written from notes that
 * stay searchable, a poor one loses nothing.
 */

/**
 * A tentative plan with no end date that nobody repeats is retired after
 * this many days. Other notes don't go stale: most true things, such as
 * "my daughter is two", are said once.
 */
export const STALE_DAYS = 60

const DAY = 24 * 60 * 60 * 1000

/** At most this many pages are tidied a night, oldest change first. */
export const TIDY_LIMIT = 20

/**
 * The repairs `page` needs on `today`, applied to it: notes past `until`
 * expire, tentative plans without an `until` that nobody repeated in
 * STALE_DAYS go stale, and notes with the same words merge into the
 * oldest. Returns whether anything changed. Never calls a model.
 */
export function repairPage(page: PageState, today: string, now: number) {
  let changed = false
  const current = page.notes.filter(isCurrent)
  for (const note of current) {
    if (note.until !== undefined && note.until < today) {
      note.retired = { reason: 'expired', at: now }
      changed = true
    } else if (
      note.kind === 'plan' &&
      note.until === undefined &&
      standingOf(note) === 'tentative' &&
      now - note.saved > STALE_DAYS * DAY
    ) {
      note.retired = { reason: 'stale', at: now }
      changed = true
    }
  }
  const first = new Map<string, Note>()
  for (const note of page.notes.filter(isCurrent)) {
    const words = normalized(note.text)
    const kept = first.get(words)
    if (!kept) {
      first.set(words, note)
      continue
    }
    kept.sources = [...new Set([...kept.sources, ...note.sources])].sort(
      (a, b) => a - b,
    )
    if (note.origin === 'stated') {
      kept.origin = 'stated'
    }
    note.retired = { reason: 'duplicate', by: kept.id, at: now }
    changed = true
  }
  return changed
}

/** What a page's tidy call is given. */
export function renderPage(
  subject: Subject,
  page: Readonly<PageState>,
  rooms: Readonly<RoomRegistry>,
) {
  const notes = page.notes.filter(isCurrent)
  return [
    `${subject.id} ${subject.name}${subject.line ? `, on the roster as: ${subject.line}` : ''}`,
    `Current profile: ${page.profile || '(none yet)'}`,
    notes.length
      ? `Notes, oldest first:\n${notes.map((note) => describeNote(note, subject, rooms)).join('\n')}`
      : 'Notes: (none current)',
  ].join('\n\n')
}

/**
 * Applies a `tidy` call to `page`: merges and supersessions between its
 * current notes (anything else is ignored), its profile within LIMITS, and
 * its roster line if given.
 */
export function applyTidy(
  subject: Subject,
  page: PageState,
  args: TidyArgs,
  now: number,
) {
  const current = (id: string) =>
    page.notes.find((note) => note.id === id && isCurrent(note))
  for (const { keep, drop } of args.merge ?? []) {
    const kept = current(keep)
    for (const id of drop ?? []) {
      const dropped = id === keep ? undefined : current(id)
      if (!kept || !dropped) {
        continue
      }
      kept.sources = [...new Set([...kept.sources, ...dropped.sources])].sort(
        (a, b) => a - b,
      )
      if (dropped.origin === 'stated') {
        kept.origin = 'stated'
      }
      dropped.retired = { reason: 'duplicate', by: kept.id, at: now }
    }
  }
  for (const { old, by } of args.supersede ?? []) {
    const older = current(old)
    const newer = current(by)
    if (!older || !newer || older === newer) {
      continue
    }
    older.retired = { reason: 'superseded', by: newer.id, at: now }
    if (!older.until || older.until > newer.since) {
      older.until = newer.since < older.since ? older.since : newer.since
    }
  }
  page.profile = clipText(args.profile ?? '', LIMITS.profile)
  if (args.line && subject.kind !== 'self') {
    subject.line = clipText(args.line, LIMITS.subjectLine)
  }
}
