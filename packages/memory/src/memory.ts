import { Type } from '@earendil-works/pi-ai'
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'

export type Fact = {
  id: string
  text: string
  /** When it was last written, in ms since the epoch. */
  at: number
}

export type MemoryState = {
  facts: Fact[]
  /** Next fact number. Facts are `m1`, `m2`, …: short enough for the model to quote. */
  next: number
}

/**
 * What Familiar knows about the people it helps. One document for the whole
 * Familiar (every conversation shares it), stored with the transcript, so a
 * fact and the reply that mentions it are committed together.
 */
export const Memory = defineDoc<MemoryState>({
  kind: 'familiar.memory',
  version: 1,
  scope: 'session',
  initial: () => ({ facts: [], next: 1 }),
  // Store a full copy now and then, so reading it never replays a long history.
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

/** Past this, the model is asked to merge facts rather than add more. */
export const SOFT_LIMIT = 4_000
/**
 * `remember` never takes memory past this, so the prompt stays small however
 * long Familiar runs. Revising and forgetting always work, so the model can
 * always get back under.
 */
export const HARD_LIMIT = 6_000

/** The facts as the model sees them; the limits measure this. */
const list = (facts: Fact[]) =>
  facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

const change = (
  api: ToolExecutionApi,
  context: Context,
  edit: (memory: MemoryState) => string,
) => api.commit(async (tx) => edit(await tx.doc(Memory)), context).then(text)

const remember = defineTool({
  name: 'remember',
  description:
    'Save a lasting fact about the person or people you help: a preference, a decision, something about their life or plans. One fact per call, written so it makes sense on its own months from now. Not for things that only matter in this exchange.',
  parameters: Type.Object({ text: Type.String() }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      const fact = { id: `m${memory.next}`, text: args.text, at: api.now() }
      const size = list([...memory.facts, fact]).length
      if (size > HARD_LIMIT)
        throw new Error(
          `Memory is full (${size} of ${HARD_LIMIT} characters with this fact), so nothing was saved. Merge related facts with revise_memory or forget stale ones, then save this again.`,
        )
      memory.next++
      memory.facts.push(fact)
      return `Saved as ${fact.id}.`
    }),
})

const revise = defineTool({
  name: 'revise_memory',
  description:
    'Rewrite a saved fact that has changed or was wrong, or merge related facts into one (revise one, forget the rest).',
  parameters: Type.Object({ id: Type.String(), text: Type.String() }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      const fact = memory.facts.find((fact) => fact.id === args.id)
      if (!fact) throw new Error(`No fact ${args.id}.`)
      fact.text = args.text
      fact.at = api.now()
      return `Revised ${fact.id}.`
    }),
})

const forget = defineTool({
  name: 'forget',
  description:
    'Delete a saved fact that is no longer true or that the person asks you to forget.',
  parameters: Type.Object({ id: Type.String() }),
  execute: (args, api, context) =>
    change(api, context, (memory) => {
      const index = memory.facts.findIndex((fact) => fact.id === args.id)
      if (index === -1) throw new Error(`No fact ${args.id}.`)
      memory.facts.splice(index, 1)
      return `Forgot ${args.id}.`
    }),
})

const render = (memory: MemoryState | undefined) => {
  const listed = list(memory?.facts ?? [])
  const guidance =
    listed.length > SOFT_LIMIT
      ? '\nMemory is getting long: merge or forget facts before adding new ones.'
      : ''
  return `What you remember. Use it without announcing it. Save new lasting facts with remember, and keep these current with revise_memory and forget.
${listed || '(nothing yet)'}${guidance}`
}

/** Long-term memory: a fact list the model sees on every request, and tools to keep it. */
export const MemoryExtension = defineExtension({
  name: 'familiar.memory',
  tools: [remember, revise, forget],
  sections: [
    // Changes only when memory does, so the provider's prompt cache holds between.
    section('memory', async (input, context) =>
      render(await input.read.snapshot(Memory, context)),
    ),
  ],
})
