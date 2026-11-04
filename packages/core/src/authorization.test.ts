import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import {
  configure,
  defineTool as piDefineTool,
  Harness,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import { afterEach, expect, test, vi } from 'vitest'
import { authorizingRegistry } from './authorization.ts'
import { harnessOptions } from './context/index.ts'
import { MESSAGE_KIND } from './conversation/message.ts'
import {
  authorizeSingleOwner,
  summonFamiliar,
  type AuthorizeTool,
  type Familiar,
  type FamiliarPlugin,
  type Invoker,
  type ToolInvocation,
} from './familiar.ts'
import {
  defineTool,
  Type,
  type FamiliarToolApi,
  type PluginExtension,
} from './index.ts'
import { ReopenableStorage } from './memory/testing.ts'

const sam = { id: 'sam', name: 'Sam' }
const asSam: Invoker = { kind: 'person', author: sam }
const output = { output: [{ type: 'text' as const, text: 'Done' }] }
const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

/**
 * A Familiar with `plugin`, whose host policy is `policy.current` at the
 * moment each tool is about to run, and records every question it's asked.
 */
async function setup(plugin: FamiliarPlugin) {
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const asked: ToolInvocation[] = []
  const policy: { current: AuthorizeTool } = { current: () => false }
  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      authorizeTool: (invocation, context) => {
        asked.push(invocation)
        return policy.current(invocation, context)
      },
      plugins: [plugin],
    })
    opened.push(familiar)
    return familiar
  }
  /** The last tool result the model read, as JSON. */
  const results: string[] = []
  const readResult = (context: TranscriptContext) => {
    results.push(JSON.stringify(context.messages.at(-1)))
    return fauxAssistantMessage('Finished.')
  }
  return { faux, open, asked, policy, results, readResult }
}

const plugin = (
  tools: NonNullable<PluginExtension['tools']>,
): FamiliarPlugin => ({
  name: 'acts',
  title: 'Acts',
  extension: () => ({ tools }),
})

test('a refused native tool never runs, and the model reads why', async () => {
  let ran = 0
  const { faux, open, asked, policy, results, readResult } = await setup(
    plugin([
      defineTool({
        name: 'act',
        description: 'Change something outside Familiar',
        parameters: Type.Object({}),
        execute: async () => {
          ran++
          return output
        },
      }),
    ]),
  )
  const familiar = await open()
  for (const [index, refuse] of [
    () => false,
    () => {
      throw new Error('Policy service down')
    },
    // A JavaScript host's mistake fails closed.
    () => undefined as unknown as boolean,
  ].entries()) {
    policy.current = refuse
    faux.setResponses([call('act'), readResult])
    await familiar.send({ author: sam, text: 'Act', requestId: `${index}` })
    await familiar.idle()
  }
  expect(ran).toBe(0)
  expect(asked).toEqual(
    Array.from({ length: 3 }, () => ({
      invoker: asSam,
      tool: 'act',
      extension: 'familiar.plugin.acts',
    })),
  )
  expect(results).toHaveLength(3)
  for (const result of results) {
    expect(result).toContain('Not permitted: act')
    expect(result).toContain('"isError":true')
    expect(result).not.toContain('Policy service down')
  }

  policy.current = () => true
  faux.setResponses([call('act'), readResult])
  await familiar.send({ author: sam, text: 'Act', requestId: 'allowed' })
  await familiar.idle()
  expect(ran).toBe(1)
})

test('a raw Pi tool is authorized too, and sees the invoker', async () => {
  const seen: Invoker[] = []
  const { faux, open, policy } = await setup(
    plugin([
      // Defined with Pi's own defineTool, not Familiar's.
      piDefineTool({
        name: 'raw',
        description: 'A Pi tool',
        parameters: Type.Object({}),
        execute: async (_args, api) => {
          seen.push((api as FamiliarToolApi).invoker)
          return output
        },
      }),
    ]),
  )
  const familiar = await open()
  faux.setResponses([call('raw'), fauxAssistantMessage('Refused.')])
  await familiar.send({ author: sam, text: 'Raw', requestId: 'refused' })
  await familiar.idle()
  expect(seen).toEqual([])

  policy.current = () => true
  faux.setResponses([call('raw'), fauxAssistantMessage('Done.')])
  await familiar.send({ author: sam, text: 'Raw', requestId: 'allowed' })
  await familiar.idle()
  expect(seen).toEqual([asSam])
})

test('a nested call is asked about on its own, for its caller’s invoker', async () => {
  let inner = 0
  let nested: unknown
  const { faux, open, asked, policy } = await setup(
    plugin([
      defineTool({
        name: 'outer',
        description: 'Calls inner',
        parameters: Type.Object({}),
        execute: async (_args, api, context) => {
          nested = await api.executeTool('inner', {}, context)
          return output
        },
      }),
      defineTool({
        name: 'inner',
        description: 'Change something outside Familiar',
        parameters: Type.Object({}),
        execute: async () => {
          inner++
          return output
        },
      }),
    ]),
  )
  policy.current = ({ tool }) => tool === 'outer'
  const familiar = await open()
  faux.setResponses([call('outer'), fauxAssistantMessage('Done.')])
  await familiar.send({ author: sam, text: 'Nest', requestId: 'nest' })
  await familiar.idle()
  expect(inner).toBe(0)
  expect(asked.map(({ invoker, tool }) => ({ invoker, tool }))).toEqual([
    { invoker: asSam, tool: 'outer' },
    { invoker: asSam, tool: 'inner' },
  ])
  expect(nested).toMatchObject({ isError: true })
  expect(JSON.stringify(nested)).toContain('Not permitted: inner')
})

test('a permission revoked during a crash refuses the replay-safe rerun', async () => {
  let attempts = 0
  const { faux, open, asked, policy, results, readResult } = await setup(
    plugin([
      defineTool({
        name: 'sync',
        description: 'Change something outside Familiar',
        parameters: Type.Object({}),
        replay: 'safe',
        execute: async (_args, _api, context) => {
          attempts++
          // The first attempt is cut off by the process ending.
          const signal = context.abortSignal!
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            }),
          )
          return output
        },
      }),
    ]),
  )
  policy.current = () => true
  const familiar = await open()
  faux.setResponses([call('sync')])
  await familiar.send({ author: sam, text: 'Sync', requestId: 'sync' })
  await vi.waitFor(() => expect(attempts).toBe(1))
  // The intent is recorded and the tool started: Pi recovers it in its
  // `execute` phase, which runs no beforeTool hook.
  opened.splice(opened.indexOf(familiar), 1)
  await familiar.dismiss()

  policy.current = () => false
  faux.setResponses([readResult])
  const reopened = await open()
  await reopened.idle()
  expect(attempts).toBe(1)
  expect(asked).toEqual([
    { invoker: asSam, tool: 'sync', extension: 'familiar.plugin.acts' },
    { invoker: asSam, tool: 'sync', extension: 'familiar.plugin.acts' },
  ])
  expect(results.at(-1)).toContain('Not permitted: sync')
})

test('a stored message with only a name runs as unknown, which a restricted host refuses', async () => {
  const context = BACKGROUND_CONTEXT
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const model = { provider: 'faux', modelId: 'faux-1' }
  const asked: Invoker[] = []
  let ran = 0
  const registry = authorizingRegistry(({ invoker }) => {
    asked.push(invoker)
    return invoker.kind === 'person'
  })
  registry.install({
    name: 'acts',
    tools: [
      defineTool({
        name: 'act',
        description: 'Change something outside Familiar',
        parameters: Type.Object({}),
        execute: async () => {
          ran++
          return output
        },
      }),
    ],
  })
  const harness = await Harness.open(
    storage,
    harnessOptions({ models, model }, registry, 64_000),
    context,
  )
  try {
    const conversation = await harness.root(context)
    await conversation.commit(
      (tx) => configure(tx, conversation.id, { model }),
      context,
    )
    faux.setResponses([call('act'), fauxAssistantMessage('Refused')])
    // The entry an older version stored: a name, no stable ID.
    await conversation.submit(
      {
        type: 'input',
        content: '[Message from "Sam"]\nAct.',
        entry: { kind: MESSAGE_KIND, data: { author: 'Sam', text: 'Act.' } },
      },
      context,
    )
    await conversation.waitForIdle(context)
  } finally {
    await harness.close(context)
  }
  expect(asked).toEqual([{ kind: 'unknown' }])
  expect(ran).toBe(0)
})

test('the invoker reaches the tool through live API getters', async () => {
  const first = createModels()
  const second = createModels()
  let current = first
  const registry = authorizingRegistry(authorizeSingleOwner)
  registry.install({
    name: 'live',
    tools: [
      defineTool({
        name: 'live_models',
        description: 'Check the current models during a call.',
        parameters: Type.Object({}),
        execute: async (_args, api) => {
          expect(api.invoker).toEqual({ kind: 'unknown' })
          expect(api.models).toBe(first)
          current = second
          expect(api.models).toBe(second)
          return { output: [] }
        },
      }),
    ],
  })
  // Only invoker lookup (no such task) and the live getter are exercised.
  const api = {
    taskId: 1,
    commit: async (change: (tx: unknown) => unknown) =>
      change({ task: async () => undefined }),
    get models() {
      return current
    },
  } as unknown as ToolExecutionApi
  const [{ tool }] = registry.snapshot().tools()
  const result = await tool.execute({}, api, BACKGROUND_CONTEXT)
  expect(result).toEqual({ output: [] })
})
