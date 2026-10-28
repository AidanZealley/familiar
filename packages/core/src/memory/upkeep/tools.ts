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

/**
 * The tools that write facts. Only upkeep has them: it reads a whole day at
 * once, so it writes better facts than a mid-conversation save, and one
 * writer means one owner for every rule. Each change goes through facts.ts.
 */

/** Checks that every ID names a person's message in the conversation. */
async function sourcesOf(tx: Tx, ids: string[]) {
  const sources = new Map<string, { entry: EntryId; day: string }>()
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

type Sources = Awaited<ReturnType<typeof sourcesOf>>

/**
 * The day a fact became or stopped being true: the one given, else the day
 * its earliest cited message was sent. Every date in memory comes from what
 * someone said, so a fact filed from a week-old backlog keeps its own day.
 */
function dayFrom(given: string | undefined, sources: Sources, what: string) {
  const day = given ?? [...sources.values()].map(({ day }) => day).sort()[0]
  if (!day) {
    throw new FactError(
      `Give ${what}, or cite the messages that show it in sources.`,
    )
  }
  return day
}

const entries = (sources: Sources) =>
  [...sources.values()].map(({ entry }) => entry)

/**
 * Commits one change. Sources are read first, since a transaction can't
 * read after writing; a refused change throws and changes nothing.
 */
const change = (
  api: ToolExecutionApi,
  context: Context,
  ids: string[],
  edit: (memory: Memory, sources: Sources) => string,
) =>
  api
    .commit(async (tx) => {
      const sources = await sourcesOf(tx, ids)
      return edit(await openMemory(tx), sources)
    }, context)
    .then((text) => ({ output: [{ type: 'text' as const, text }] }))

const SOURCES =
  'The [x…] IDs of the messages it came from, as shown in the conversation.'

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
    since: Type.Optional(
      Type.String({
        description:
          'The day it became true, YYYY-MM-DD, when the conversation says so. Defaults to the day of its earliest source.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, args.sources, (memory, sources) => {
      if (!sources.size) {
        throw new FactError('Cite at least one message the fact came from.')
      }
      const fact = rememberFact(
        memory,
        {
          text: args.text,
          importance: args.importance,
          since: dayFrom(args.since, sources, 'since'),
          sources: entries(sources),
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
          'The day the new version became true, YYYY-MM-DD. Defaults to the day of its earliest source; needed without sources.',
      }),
    ),
    merge: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Other facts the new text also covers.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, args.sources ?? [], (memory, sources) => {
      const fact = reviseFact(
        memory,
        args.id,
        {
          text: args.text,
          since: dayFrom(args.since, sources, 'since'),
          sources: entries(sources),
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
    sources: Type.Optional(
      Type.Array(Type.String(), {
        description: `${SOURCES} Those that show it stopped being true.`,
      }),
    ),
    until: Type.Optional(
      Type.String({
        description:
          'The day it stopped being true, YYYY-MM-DD. Defaults to the day of its earliest source; needed without sources.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, args.sources ?? [], (memory, sources) => {
      retireFact(memory, args.id, dayFrom(args.until, sources, 'until'))
      return `Retired ${args.id}.`
    }),
})

export const upkeepTools = [remember, revise, retire]
