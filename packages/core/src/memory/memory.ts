import { Type } from '@earendil-works/pi-ai'
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'
import {
  coreFacts,
  forgetFact,
  listFacts,
  migrateV1,
  rememberFact,
  retireFact,
  reviseFact,
  type MemoryState,
} from './facts.ts'

/**
 * What Familiar knows about the people it helps. One document for the whole
 * Familiar (every conversation shares it), stored with the transcript, so a
 * fact and the reply that mentions it are committed together.
 */
export const Memory = defineDoc<MemoryState>({
  kind: 'familiar.memory',
  version: 2,
  scope: 'session',
  initial: () => ({ facts: [], next: 1 }),
  migrate: (value, fromVersion) => {
    if (fromVersion !== 1)
      throw new Error(`No migration from memory version ${fromVersion}.`)
    return migrateV1(value as Parameters<typeof migrateV1>[0])
  },
  // Store a full copy now and then, so reading it never replays a long history.
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

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
      return fact.core
        ? `Saved as ${fact.id}.`
        : `Saved as ${fact.id}. It is kept outside what you always see, because it is minor or that space is full.`
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
      return `Saved as ${fact.id}; ${fact.replaces!.join(', ')} now history.`
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

const render = (memory: MemoryState | undefined) => {
  const listed = memory ? listFacts(coreFacts(memory)) : ''
  return `What you remember. Use it without announcing it. Save new lasting facts with remember. When one changes, use revise_memory; when it stops being true, retire it. Use forget only when someone asks you to forget something.
${listed || '(nothing yet)'}`
}

/** Long-term memory: core facts the model sees on every request, and tools to keep the store. */
export const MemoryExtension = defineExtension({
  name: 'familiar.memory',
  tools: [remember, revise, retire, forget],
  sections: [
    // Changes only when core does, so the provider's prompt cache holds between.
    section('memory', async (input, context) =>
      render(await input.read.snapshot(Memory, context)),
    ),
  ],
})
