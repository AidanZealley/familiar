import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  type EntryId,
  type ToolExecutionApi,
  type Tx,
} from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'
import { saidBy } from '../../conversation/message.ts'
import { localDay } from '../../time.ts'
import { entryOf } from '../exchanges.ts'
import {
  FactError,
  openMemory,
  rememberFact,
  retireFact,
  reviseFact,
  type Memory,
} from '../facts.ts'
import { familiarFor, type FamiliarId } from '../../workspace/familiars.ts'

/**
 * The tools that write facts. Only upkeep has them: it reads a whole day at
 * once, so it writes better facts than a mid-conversation save, and one
 * writer means one owner for every rule. Each change goes through facts.ts.
 */

/**
 * Checks that every ID names an input in `familiar`'s chat: a person's
 * message, a reminder or a handoff. Facts from what a room showed with it
 * cite it too.
 */
async function sourcesOf(
  tx: Tx,
  familiar: FamiliarId,
  ids: string[],
  timeZone: string,
) {
  const sources = new Map<string, { entry: EntryId; day: string }>()
  for (const id of ids) {
    const entry = entryOf(id)
    const record = entry === undefined ? undefined : await tx.entry(entry)
    const said =
      record?.conversationId === familiar ? saidBy(record) : undefined
    if (entry === undefined || !said || said.role === 'assistant') {
      throw new FactError(
        `${id} is not an exchange. Cite the [x…] IDs of the conversation's lines.`,
      )
    }
    sources.set(id, { entry, day: localDay(said.at, timeZone) })
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
 * Commits one change to the memory of the Familiar whose upkeep calls it.
 * Sources are read first, since a transaction can't read after writing; a
 * refused change throws and changes nothing.
 */
const change = (
  api: ToolExecutionApi,
  context: Context,
  timeZone: string,
  ids: string[],
  edit: (memory: Memory, sources: Sources) => string,
) =>
  api
    .commit(async (tx) => {
      const familiar = await familiarFor(tx, api.conversationId)
      const sources = await sourcesOf(tx, familiar, ids, timeZone)
      return edit(await openMemory(tx, familiar), sources)
    }, context)
    .then((text) => ({ output: [{ type: 'text' as const, text }] }))

const SOURCES =
  'The [x…] IDs of the messages it came from, as shown in the conversation.'

/** The writing tools, dating sources in `timeZone`. */
export function upkeepTools(timeZone: string) {
  const remember = defineTool({
    name: 'remember',
    description:
      "Save a lasting fact the assistant couldn't otherwise know next time: about the people it helps, their preferences, decisions and plans, or how to help them well. Not what the assistant already holds itself (schedules, reminders, connections, settings), and not passing events. One statement of at most 300 characters, written so it makes sense on its own months from now.",
    parameters: Type.Object({
      text: Type.String(),
      importance: Type.Integer({
        minimum: 1,
        maximum: 5,
        description:
          'How badly would a reply about something unrelated go without this? 5: it could be wrong or harmful; who someone is, who matters to them and what could harm them are usually 4 or 5. 4: clearly worse. 4 and 5 go into core, which is read in every conversation and is small. 3: matters only when one subject or task comes up, however firmly stated; likely to. 2: only might come up. 1: hardly matters. Being asked to remember it does not raise this.',
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
      change(api, context, timeZone, args.sources, (memory, sources) => {
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
      'Save a new version of a fact that has changed or was wrong; the old version becomes past, ending the day the new one begins. The new text replaces the old, so it must keep everything from the old that is still true; if it would drop something, keep that as its own fact. To merge facts that say the same thing, revise one and list the others in merge.',
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
      change(api, context, timeZone, args.sources ?? [], (memory, sources) => {
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
      'Mark a fact as no longer true, such as an old address, a finished project or a plan whose day has passed. It is kept as history. Not for duplicates: merge those with revise_memory, and not to replace a fact that only partly changed: revise it.',
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
      change(api, context, timeZone, args.sources ?? [], (memory, sources) => {
        retireFact(memory, args.id, dayFrom(args.until, sources, 'until'))
        return `Retired ${args.id}.`
      }),
  })

  return [remember, revise, retire]
}
