import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  ROOT_CONVERSATION_ID,
  type EntryId,
  type ToolExecutionApi,
  type Tx,
} from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'
import { saidBy } from '../../conversation/message.ts'
import { localDay } from '../../time/index.ts'
import { entryOf } from '../exchanges.ts'
import {
  FactError,
  openMemory,
  rememberFact,
  retireFact,
  reviseFact,
  type Memory,
} from '../facts.ts'
import type { UpkeepStep } from './index.ts'
import { Upkeep } from './schedule.ts'

/**
 * The tools that write facts. Only upkeep has them: it reads a whole day at
 * once, so it writes better facts than a mid-conversation save, and one
 * writer means one owner for every rule. Each change goes through facts.ts.
 */

/** What a writing tool knows besides its arguments, read before it writes. */
type Batch = {
  /** The day being filed, for facts and retirements given no day. */
  day: string
  /** Each cited source's entry and the local day it was sent. */
  sources: Map<string, { entry: EntryId; day: string }>
}

/**
 * The day of the batch the pass is filing, from upkeep's own checkpoint, or
 * today outside a pass. Read from the task rather than stored again, so the
 * checkpoint stays the one owner of what is being filed.
 */
async function batchDay(tx: Tx, now: number) {
  const upkeep = await tx.doc(Upkeep)
  const task = upkeep.task === null ? undefined : await tx.task(upkeep.task)
  const step =
    task?.state.status === 'running' || task?.state.status === 'sleeping'
      ? (task.state.checkpoint as UpkeepStep)
      : undefined
  return step?.phase === 'consolidate' && step.end ? step.end : localDay(now)
}

/** Checks that every ID names a person's message in the conversation. */
async function sourcesOf(tx: Tx, ids: string[]) {
  const sources: Batch['sources'] = new Map()
  for (const id of ids) {
    const entry = entryOf(id)
    const record = entry === undefined ? undefined : await tx.entry(entry)
    const said =
      record?.conversationId === ROOT_CONVERSATION_ID
        ? saidBy(record)
        : undefined
    if (entry === undefined || said?.role !== 'person') {
      throw new FactError(
        `${id} is not a message from a person. Cite the [x…] IDs of the conversation's messages.`,
      )
    }
    sources.set(id, { entry, day: localDay(said.at) })
  }
  return sources
}

/** The day the earliest cited message was sent, else the batch's. */
const earliestDay = (batch: Batch) =>
  [...batch.sources.values()].map(({ day }) => day).sort()[0] ?? batch.day

/**
 * Commits one change. Reads come first, since a transaction can't read
 * after writing; a refused change throws and changes nothing.
 */
const change = (
  api: ToolExecutionApi,
  context: Context,
  sources: string[],
  edit: (memory: Memory, batch: Batch) => string,
) =>
  api
    .commit(async (tx) => {
      const batch = {
        sources: await sourcesOf(tx, sources),
        day: await batchDay(tx, api.now()),
      }
      return edit(await openMemory(tx), batch)
    }, context)
    .then((text) => ({ output: [{ type: 'text' as const, text }] }))

const entries = (batch: Batch) =>
  [...batch.sources.values()].map(({ entry }) => entry)

const SOURCES =
  'The [x…] IDs of the messages it came from, as shown in the conversation.'
const SINCE =
  'The day it became true, YYYY-MM-DD, when the conversation says so. Defaults to the day of its earliest source.'

const remember = defineTool({
  name: 'remember',
  description:
    'Save a lasting fact about the person or people the assistant helps: a preference, a decision, something about their life or plans. One statement of at most 300 characters, written so it makes sense on its own months from now.',
  parameters: Type.Object({
    text: Type.String(),
    importance: Type.Integer({
      minimum: 1,
      maximum: 5,
      description:
        '5: identity, close people, health, standing commitments, and anything they asked to be remembered. 3: ordinary lasting facts. 1: minor preferences and details.',
    }),
    sources: Type.Array(Type.String(), { minItems: 1, description: SOURCES }),
    since: Type.Optional(Type.String({ description: SINCE })),
  }),
  execute: (args, api, context) =>
    change(api, context, args.sources, (memory, batch) => {
      if (!batch.sources.size) {
        throw new FactError('Cite at least one message the fact came from.')
      }
      const fact = rememberFact(
        memory,
        {
          text: args.text,
          importance: args.importance,
          since: args.since ?? earliestDay(batch),
          sources: entries(batch),
        },
        api.now(),
      )
      return `Saved as ${fact.id}${fact.core ? ', in core' : ''}.`
    }),
})

const revise = defineTool({
  name: 'revise_memory',
  description:
    'Save a new version of a fact that has changed or was wrong; the old version becomes past, ending the day the new one begins. To merge facts that say the same thing, revise one and list the others in merge.',
  parameters: Type.Object({
    id: Type.String(),
    text: Type.String(),
    sources: Type.Optional(
      Type.Array(Type.String(), {
        description: `${SOURCES} The old versions' sources are kept too.`,
      }),
    ),
    importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    since: Type.Optional(
      Type.String({
        description:
          'The day the new version became true, YYYY-MM-DD. Defaults to the day of its earliest source, or of the conversation being filed.',
      }),
    ),
    merge: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Other facts the new text also covers.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, args.sources ?? [], (memory, batch) => {
      const fact = reviseFact(
        memory,
        args.id,
        {
          text: args.text,
          since: args.since ?? earliestDay(batch),
          sources: entries(batch),
          importance: args.importance,
          merge: args.merge,
        },
        api.now(),
      )
      return `Saved as ${fact.id}; ${fact.replaces!.join(', ')} now past.`
    }),
})

const retire = defineTool({
  name: 'retire',
  description:
    'Mark a fact as no longer true, such as an old address or a finished project. It is kept as history. Not for duplicates: merge those with revise_memory.',
  parameters: Type.Object({
    id: Type.String(),
    until: Type.Optional(
      Type.String({
        description:
          'The day it stopped being true, YYYY-MM-DD. Defaults to the day of the conversation being filed.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, [], (memory, batch) => {
      retireFact(memory, args.id, args.until ?? batch.day)
      return `Retired ${args.id}.`
    }),
})

export const upkeepTools = [remember, revise, retire]
