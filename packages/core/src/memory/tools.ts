import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  ROOT_CONVERSATION_ID,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'
import {
  forgetFact,
  markRecalled,
  Memory,
  rememberFact,
  retireFact,
  reviseFact,
  setImportance,
  type MemoryState,
} from './facts.ts'
import { Episodes } from './episodes.ts'
import { searchMemory } from './recall.ts'

/** The tools the model keeps memory with. Each change goes through facts.ts's rules. */

/**
 * The details of a memory tool's result that saved a fact. Clients read this,
 * not the text the model sees, to show what a reply saved.
 */
export type SavedDetails = { saved: string }

type Result = string | { text: string; saved: string }

const toResult = (result: Result) =>
  typeof result === 'string'
    ? { output: [{ type: 'text' as const, text: result }] }
    : {
        output: [{ type: 'text' as const, text: result.text }],
        details: { saved: result.saved } satisfies SavedDetails,
      }

const change = (
  api: ToolExecutionApi,
  context: Context,
  edit: (memory: MemoryState) => Result,
) =>
  api.commit(async (tx) => edit(await tx.doc(Memory)), context).then(toResult)

const remember = defineTool({
  name: 'remember',
  description:
    'Save a lasting fact about the person or people you help: a preference, a decision, something about their life or plans. One fact per call, written so it makes sense on its own months from now. Not for things that only matter in this exchange.',
  parameters: Type.Object({
    text: Type.String(),
    importance: Type.Integer({
      minimum: 1,
      maximum: 5,
      description:
        '5: identity, close people, health, standing commitments. 3: ordinary lasting facts. 1: minor preferences and details.',
    }),
  }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      const fact = rememberFact(memory, args.text, args.importance, api.now())
      return {
        saved: fact.id,
        text: fact.core
          ? `Saved as ${fact.id}.`
          : `Saved as ${fact.id}. It is kept outside what you always see, because it is minor or that space is full.`,
      }
    }),
})

const revise = defineTool({
  name: 'revise_memory',
  description:
    'Save a new version of a fact that has changed or was wrong. The old version is kept as history. To merge facts that say the same thing, revise one and list the others in merge.',
  parameters: Type.Object({
    id: Type.String(),
    text: Type.String(),
    merge: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Other facts the new text also covers.',
      }),
    ),
  }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      const fact = reviseFact(memory, args.id, args.text, api.now(), args.merge)
      return {
        saved: fact.id,
        text: `Saved as ${fact.id}; ${fact.replaces!.join(', ')} now history.`,
      }
    }),
})

const retire = defineTool({
  name: 'retire',
  description:
    'Mark a fact as no longer true, such as an old address or a finished project. It is kept as history. Not for duplicates: merge those with revise_memory.',
  parameters: Type.Object({ id: Type.String() }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      retireFact(memory, args.id, api.now())
      return `Retired ${args.id}.`
    }),
})

const forget = defineTool({
  name: 'forget',
  description:
    'Delete a fact outright, leaving no history. Only when someone asks you to forget it; use retire for things that stopped being true.',
  parameters: Type.Object({ id: Type.String() }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      forgetFact(memory, args.id)
      return `Forgot ${args.id}.`
    }),
})

const recall = defineTool({
  name: 'recall',
  description:
    "Search everything you remember beyond what you always see: facts, including ones no longer current, each with when it was true, and episodes, summaries of what happened each day, week and month. Use it when you need something you don't see, such as an earlier address, a detail of an old project or what was going on at a time.",
  parameters: Type.Object({ query: Type.String() }),
  execute: (args, api, context) =>
    api
      .commit(async (tx) => {
        const memory = await tx.doc(Memory)
        const episodes = await tx.doc(Episodes)
        const { found, used } = searchMemory(
          memory,
          episodes,
          args.query,
          api.now(),
          {
            limit: 12,
            tokens: 3_000,
          },
        )
        // Only conversation counts as use; upkeep's searches are housekeeping.
        if (api.conversationId === ROOT_CONVERSATION_ID) {
          markRecalled(memory, used, api.now())
        }
        return found.length
          ? found.map(({ line }) => line).join('\n')
          : 'Nothing found.'
      }, context)
      .then(toResult),
})

const rate = defineTool({
  name: 'set_importance',
  description:
    'Re-rate how much a fact matters, 1 to 5, when it has proved more or less important than first rated. It decides whether the fact stays among what you always see.',
  parameters: Type.Object({
    id: Type.String(),
    importance: Type.Integer({ minimum: 1, maximum: 5 }),
  }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      setImportance(memory, args.id, args.importance)
      return `${args.id} is now importance ${args.importance}.`
    }),
})

export const memoryTools = [remember, revise, retire, rate, recall, forget]
