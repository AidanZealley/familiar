import { Type, type Static } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { Author } from '../../conversation/message.ts'
import { localDay } from '../../time.ts'
import { monthOf } from '../dates.ts'
import {
  clipText,
  dayOrUndefined,
  LIMITS,
  normalized,
  type JournalState,
  type MemoryState,
  type PageState,
  type Subject,
} from '../store.ts'
import type { BatchMessage } from './batch.ts'

/**
 * Filing's one call, `file`, and how code applies it. A note or journal
 * line is kept only if its quote is in a person message of the batch, and
 * who said it and where are read from that message, never from the model.
 */

const evidence = {
  m: Type.Array(Type.Integer(), {
    description: 'The numbers of the messages it rests on.',
  }),
  quote: Type.String({
    description: 'Words copied exactly from one of those messages.',
  }),
}

export const FileArgs = Type.Object({
  subjects: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        kind: Type.Union([Type.Literal('person'), Type.Literal('topic')]),
        line: Type.String({
          description: 'One line for the roster, such as "Maya\'s partner".',
        }),
      }),
      { description: 'New subjects, which notes then name by name.' },
    ),
  ),
  notes: Type.Optional(
    Type.Array(
      Type.Object({
        subject: Type.String({
          description:
            "The page it goes on: an id, s…, or a new subject's name.",
        }),
        text: Type.String({
          description: `One statement, at most ${LIMITS.note} characters.`,
        }),
        since: Type.Optional(
          Type.String({ description: 'When it became true, YYYY-MM-DD.' }),
        ),
        ...evidence,
        replaces: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Notes, n…, this one replaces.',
          }),
        ),
      }),
    ),
  ),
  journal: Type.Optional(
    Type.Array(
      Type.Object({
        on: Type.String({ description: 'The day it happened, YYYY-MM-DD.' }),
        text: Type.String({
          description: `One line, at most ${LIMITS.line} characters.`,
        }),
        ...evidence,
      }),
    ),
  ),
})

export type FileArgs = Static<typeof FileArgs>

/** Only receives its answer and ends the call; the pass applies it. */
export const fileTool = defineTool({
  name: 'file',
  description:
    'Write what is worth keeping from these messages, all in one call. Call it with nothing if nothing is.',
  parameters: FileArgs,
  execute: async () => ({
    output: [{ type: 'text' as const, text: 'Received.' }],
    control: { terminate: true },
  }),
})

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
  const cited = messages.filter((each) => m?.includes(each.m))
  for (const message of new Set([...cited, ...messages])) {
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

/** Where applying reads and writes: a commit's documents, or plain maps in tests. */
export type FilingStore = {
  memory: MemoryState
  page(subject: string): Promise<PageState>
  /** A month's journal, `YYYY-MM`, listed in the index. */
  month(month: string): Promise<JournalState>
}

/**
 * Applies `args` from a batch of `messages` to `store`. A replaced note is
 * removed: it stays findable in the conversation it came from. `pages` are
 * those the call was shown, the only ones whose notes it may replace.
 */
export async function applyFiling(
  store: FilingStore,
  messages: readonly BatchMessage[],
  pages: readonly string[],
  args: FileArgs,
  { now, timeZone }: { now: number; timeZone: string },
) {
  const { memory } = store
  const dayOf = (message: BatchMessage) => localDay(message.at, timeZone)
  const named = (name: string) =>
    memory.subjects.find(
      (subject) => normalized(subject.name) === normalized(name),
    )

  /** The subject a note names, made now if it is one of the call's new ones. */
  const subjectFor = (ref: string): Subject | undefined => {
    const found =
      memory.subjects.find((subject) => subject.id === ref) ?? named(ref)
    const added = (args.subjects ?? []).find(
      (subject) => normalized(subject.name) === normalized(ref),
    )
    if (found || !added || !clipText(added.name, LIMITS.name)) {
      return found
    }
    const subject: Subject = {
      id: `s${memory.next.subject++}`,
      kind: added.kind === 'topic' ? 'topic' : 'person',
      name: clipText(added.name, LIMITS.name),
      line: clipText(added.line ?? '', LIMITS.subjectLine),
      changed: now,
      profiled: 0,
    }
    memory.subjects.push(subject)
    return subject
  }

  for (const op of args.notes ?? []) {
    const found = evidenceFor(messages, op.m, op.quote)
    const subject = subjectFor(op.subject ?? '')
    const text = clipText(op.text ?? '', LIMITS.note)
    if (!found || !subject || !text) {
      continue
    }
    const page = await store.page(subject.id)
    if (page.notes.some((note) => normalized(note.text) === normalized(text))) {
      continue
    }
    for (const id of op.replaces ?? []) {
      for (const shown of pages) {
        const other = await store.page(shown)
        const at = other.notes.findIndex((note) => note.id === id)
        if (at !== -1) {
          other.notes.splice(at, 1)
          memory.subjects.find((each) => each.id === shown)!.changed = now
        }
      }
    }
    page.notes.push({
      id: `n${memory.next.note++}`,
      text,
      since: dayOrUndefined(op.since) ?? dayOf(found.message),
      quote: clipText(op.quote, LIMITS.quote),
      source: found.message.entry,
      saidBy: found.said,
      ...(found.message.room !== undefined && { room: found.message.room }),
      saved: now,
    })
    subject.changed = now
  }

  for (const op of args.journal ?? []) {
    const found = evidenceFor(messages, op.m, op.quote)
    const text = clipText(op.text ?? '', LIMITS.line)
    if (!found || !text) {
      continue
    }
    const { message, said } = found
    const journal = await store.month(monthOf(dayOf(message)))
    journal.lines.push({
      exchange: message.entry,
      on: dayOrUndefined(op.on) ?? dayOf(message),
      text,
      quote: clipText(op.quote, LIMITS.quote),
      saidBy: said,
      ...(message.room !== undefined && { room: message.room }),
    })
  }
}
