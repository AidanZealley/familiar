import type { Author } from '../../conversation/message.ts'
import { localDay } from '../../time.ts'
import { monthOf } from '../dates.ts'
import {
  clipText,
  dayOrUndefined,
  isCurrent,
  LIMITS,
  normalized,
  SELF,
  subjectNamed,
  type JournalState,
  type MemoryState,
  type Note,
  type NoteKind,
  type PageState,
  type Subject,
} from '../store.ts'
import type { BatchMessage } from './batch.ts'
import type { FileArgs } from './tools.ts'

/**
 * Applying a `file` call: the rules that make memory trustworthy, in plain
 * code. An operation is kept only if its quote is in a person message of
 * the batch; who said it and where are read from that message, never from
 * the model; and nothing is written from a message someone asked to forget.
 * Anything else is dropped, with the reason, and the rest still applies.
 * A subject the call makes must get a note, or it isn't made. People who
 * take part already have pages (`meetPeople`, when the batch is selected).
 */

/** Where applying reads and writes: a commit's documents, or plain maps in tests. */
export type FilingStore = {
  memory: MemoryState
  /** A subject's page. */
  page(subject: string): Promise<PageState>
  /** A month's journal, `YYYY-MM`. */
  month(month: string): Promise<JournalState>
}

/** An operation applying left out, and why. */
export type Dropped = { what: string; why: string }

export type Applied = {
  /** Operations applied. */
  applied: number
  dropped: Dropped[]
}

/**
 * The message whose words hold `quote`, and who said them: one it cites,
 * else any other of the batch, since models often cite a neighbour.
 */
export function evidenceFor(
  messages: readonly BatchMessage[],
  m: readonly number[],
  quote: string,
): { message: BatchMessage; said: Author } | undefined {
  const words = normalized(quote ?? '')
  if (!words) {
    return undefined
  }
  const cited = messages.filter((each) => m.includes(each.m))
  for (const message of [
    ...cited,
    ...messages.filter((each) => !cited.includes(each)),
  ]) {
    if (normalized(message.text).includes(words)) {
      return { message, said: message.author }
    }
    const shown = message.shown.find((line) =>
      normalized(line.text).includes(words),
    )
    if (shown) {
      return { message, said: shown.author }
    }
  }
  return undefined
}

const NOTE_KINDS: NoteKind[] = ['fact', 'preference', 'plan', 'lesson']

/**
 * Applies `args` from a batch of `messages`, whose pages the call was shown
 * are `pages`, to `store`. `now` dates what is written; days come from the
 * messages, in `timeZone`.
 */
export async function applyFiling(
  store: FilingStore,
  messages: readonly BatchMessage[],
  pages: readonly string[],
  args: FileArgs,
  { now, timeZone }: { now: number; timeZone: string },
): Promise<Applied> {
  const { memory } = store
  const result: Applied = { applied: 0, dropped: [] }
  const drop = (what: string, why: string) => result.dropped.push({ what, why })
  const forgotten = new Set(memory.forgotten)
  const changed = new Set<string>()
  const dayOf = (message: BatchMessage) => localDay(message.at, timeZone)

  // New subjects first: notes and lines may name them by ref.
  const refs = new Map<string, string>()
  const created = new Set<string>()
  const subjectById = (id: string) =>
    memory.subjects.find((subject) => subject.id === id)
  const resolve = (name: string | undefined): Subject | undefined => {
    if (!name) {
      return undefined
    }
    const id = refs.get(name) ?? name
    return subjectById(id) ?? subjectNamed(memory, name)
  }
  for (const op of args.subjects ?? []) {
    if ('ref' in op) {
      const name = clipText(op.name ?? '', LIMITS.name)
      if (!name) {
        drop(`subject ${op.ref}`, 'it has no name')
        continue
      }
      const existing = subjectNamed(memory, name)
      if (existing) {
        refs.set(op.ref, existing.id)
        continue
      }
      const subject: Subject = {
        id: `s${memory.next.subject++}`,
        kind: op.kind === 'topic' ? 'topic' : 'person',
        name,
        aliases: (op.aliases ?? [])
          .map((alias) => clipText(alias, LIMITS.name))
          .filter(Boolean),
        line: clipText(op.line ?? '', LIMITS.subjectLine),
        changed: now,
      }
      memory.subjects.push(subject)
      refs.set(op.ref, subject.id)
      created.add(subject.id)
      result.applied++
    } else {
      const subject = subjectById(op.id)
      if (!subject || subject.kind === 'self') {
        drop(`subject ${op.id}`, 'no such subject to change')
        continue
      }
      for (const alias of op.aliases ?? []) {
        const clipped = clipText(alias, LIMITS.name)
        if (clipped && !subjectNamed(memory, clipped)) {
          subject.aliases.push(clipped)
        }
      }
      if (op.line) {
        subject.line = clipText(op.line, LIMITS.subjectLine)
      }
      // People who take part are named by the workspace.
      if (op.name && !subject.participant) {
        subject.name = clipText(op.name, LIMITS.name)
      }
      subject.changed = now
      result.applied++
    }
  }

  /** The current note `id` on one of the pages the call was shown. */
  const findNote = async (id: string) => {
    for (const subject of pages) {
      const page = await store.page(subject)
      const note = page.notes.find((note) => note.id === id)
      if (note) {
        return isCurrent(note) ? { note, subject } : undefined
      }
    }
    return undefined
  }
  /** The evidence for an operation, or why there is none. */
  const check = (m: readonly number[] | undefined, quote: string) => {
    const found = evidenceFor(messages, m ?? [], quote)
    if (!found) {
      return 'its quote is in no message of the batch'
    }
    if (forgotten.has(found.message.entry)) {
      return 'its message was forgotten'
    }
    return found
  }
  const addSources = (note: Note, message: BatchMessage) => {
    if (!note.sources.includes(message.entry)) {
      note.sources = [...note.sources, message.entry].sort((a, b) => a - b)
    }
    if (message.asked) {
      note.origin = 'stated'
    }
  }

  for (const [index, op] of (args.notes ?? []).entries()) {
    const what = `note ${index + 1} on ${op.subject} ("${clipText(op.text ?? '', LIMITS.note)}")`
    const found = check(op.m, op.quote)
    if (typeof found === 'string') {
      drop(what, found)
      continue
    }
    const kind = NOTE_KINDS.includes(op.kind) ? op.kind : 'fact'
    // Lessons are about how the Familiar works: only its own page has them.
    const subject = kind === 'lesson' ? subjectById(SELF) : resolve(op.subject)
    const text = clipText(op.text ?? '', LIMITS.note)
    if (!subject || !text) {
      drop(what, subject ? 'it has no text' : `no subject ${op.subject}`)
      continue
    }
    const page = await store.page(subject.id)
    // Said again: a confirmation, not a second note.
    const same = page.notes.find(
      (note) => isCurrent(note) && normalized(note.text) === normalized(text),
    )
    if (same) {
      addSources(same, found.message)
      changed.add(subject.id)
      result.applied++
      continue
    }
    const note: Note = {
      id: `n${memory.next.note++}`,
      kind,
      text,
      mentions: [
        ...new Set(
          (op.mentions ?? []).flatMap((name) => {
            const other = resolve(name)
            return other && other.id !== subject.id ? [other.id] : []
          }),
        ),
      ],
      since: dayOrUndefined(op.since) ?? dayOf(found.message),
      ...(dayOrUndefined(op.until) && { until: dayOrUndefined(op.until) }),
      quote: clipText(op.quote, LIMITS.quote),
      sources: [found.message.entry],
      saidBy: found.said,
      ...(found.message.room !== undefined && { room: found.message.room }),
      origin: found.message.asked ? 'stated' : 'inferred',
      saved: now,
    }
    for (const id of op.replaces ?? []) {
      const old = await findNote(id)
      if (!old) {
        drop(`${what} replacing ${id}`, 'no such current note')
        continue
      }
      old.note.retired = { reason: 'superseded', by: note.id, at: now }
      if (!old.note.until || old.note.until > note.since) {
        old.note.until =
          note.since < old.note.since ? old.note.since : note.since
      }
      changed.add(old.subject)
    }
    page.notes.push(note)
    changed.add(subject.id)
    result.applied++
  }

  // A page is for something there is something to know about. A subject
  // this call made that got no note is only a name, so it goes again; what
  // else named it (a mention, a journal line) then names nothing.
  for (const id of created) {
    if (changed.has(id)) {
      continue
    }
    const index = memory.subjects.findIndex((subject) => subject.id === id)
    const [subject] = memory.subjects.splice(index, 1)
    for (const [ref, to] of refs) {
      if (to === id) {
        refs.delete(ref)
      }
    }
    for (const page of changed) {
      for (const note of (await store.page(page)).notes) {
        note.mentions = note.mentions.filter((other) => other !== id)
      }
    }
    drop(`subject ${subject.name}`, 'no note was written about it')
    result.applied--
  }

  for (const op of args.confirm ?? []) {
    const what = `confirm ${op.note}`
    const found = check(op.m, op.quote)
    if (typeof found === 'string') {
      drop(what, found)
      continue
    }
    const target = await findNote(op.note)
    if (!target) {
      drop(what, 'no such current note')
      continue
    }
    addSources(target.note, found.message)
    changed.add(target.subject)
    result.applied++
  }

  for (const op of args.retire ?? []) {
    const what = `retire ${op.note}`
    const found = check(op.m, op.quote)
    if (typeof found === 'string') {
      drop(what, found)
      continue
    }
    const target = await findNote(op.note)
    if (!target) {
      drop(what, 'no such current note')
      continue
    }
    const day = dayOf(found.message)
    target.note.retired = {
      reason: op.reason === 'obsolete' ? 'obsolete' : 'contradicted',
      at: now,
    }
    if (!target.note.until || target.note.until > day) {
      target.note.until = day < target.note.since ? target.note.since : day
    }
    changed.add(target.subject)
    result.applied++
  }

  for (const [index, op] of (args.journal ?? []).entries()) {
    const what = `journal line ${index + 1} ("${clipText(op.text ?? '', LIMITS.line)}")`
    const found = check(op.m, op.quote)
    if (typeof found === 'string') {
      drop(what, found)
      continue
    }
    const text = clipText(op.text ?? '', LIMITS.line)
    if (!text) {
      drop(what, 'it has no text')
      continue
    }
    const { message, said } = found
    const journal = await store.month(monthOf(dayOf(message)))
    if (
      journal.lines.some(
        (line) =>
          line.exchange === message.entry &&
          normalized(line.text) === normalized(text),
      )
    ) {
      continue
    }
    journal.lines.push({
      exchange: message.entry,
      on: dayOrUndefined(op.on) ?? dayOf(message),
      text,
      subjects: [
        ...new Set(
          (op.subjects ?? []).flatMap((name) => resolve(name)?.id ?? []),
        ),
      ],
      quote: clipText(op.quote, LIMITS.quote),
      saidBy: said,
      ...(message.room !== undefined && { room: message.room }),
    })
    result.applied++
  }

  for (const id of changed) {
    subjectById(id)!.changed = now
  }
  return result
}
