import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, onTestFinished, test } from 'vitest'
import { seedPage, withHarness } from '../memory/testing.ts'
import { scriptedModels } from '../models/scripted.ts'
import { memorySecrets } from '../connections/index.ts'
import {
  definePlugin,
  defineTool,
  schema,
  type FamiliarSecrets,
} from '../index.ts'
import { offeredTools, ReopenableStorage, replyTo } from '../testing.ts'
import { createFamiliar, type FamiliarId } from './familiars.ts'
import {
  CapabilityError,
  openWorkspace,
  type WorkspaceFamiliar,
} from './index.ts'
import { defaultPersona } from '../persona.ts'

const read = async <T>(
  watch: () => Promise<{ value: T; stop(): Promise<unknown> }>,
) => {
  const opened = await watch()
  await opened.stop()
  return opened.value
}

test('Familiars in one workspace each keep their own chat, memory, schedules, model level and identity', async () => {
  const storage = new ReopenableStorage()
  // Ada remembers Miso, as her memory would have kept it; Bo knows nothing
  // but has a persona of his own.
  const { ada, bo } = await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const ada = await createFamiliar(tx, { name: 'Ada' })
      const bo = await createFamiliar(tx, {
        name: 'Bo',
        persona: 'You’re a gardener.',
      })
      await seedPage(
        tx,
        ada,
        {
          name: 'Aidan',
          kind: 'person',
          person: 'aidan',
        },
        'Has a cat called Miso',
      )
      return { ada, bo }
    }, BACKGROUND_CONTEXT),
  )

  // Each request as the model sees it, prompt included.
  const requests: string[] = []
  const workspace = await openWorkspace({
    storage,
    models: scriptedModels(
      (request) => {
        if (request.type === 'tool-result') {
          return fauxAssistantMessage('Scheduled.')
        }
        requests.push(JSON.stringify(request.context))
        return request.type === 'message' && request.text.includes('Remind')
          ? fauxAssistantMessage(
              [
                fauxToolCall('schedule', {
                  prompt: 'Remind Aidan to feed Miso',
                  at: '2030-01-01 09:00',
                }),
              ],
              { stopReason: 'toolUse' },
            )
          : fauxAssistantMessage('Hello.')
      },
      { models: [{ id: 'sol', reasoning: true }] },
    ),
    chatModel: { provider: 'faux', modelId: 'sol' },
    timeZone: 'UTC',
    hostInstructions: 'Replies render as plain text.',
  })
  onTestFinished(() => workspace.dismiss())

  const familiar = (id: typeof ada) => workspace.familiars.get(id)!
  const say = async (id: typeof ada, text: string) => {
    const dm = (await workspace.rooms.get(
      await workspace.rooms.dm(id, 'aidan'),
    ))!
    await replyTo(
      dm,
      await dm.post({
        author: { id: 'aidan', name: 'Aidan' },
        text,
        requestId: text,
      }),
    )
  }

  await familiar(ada).setThinkingLevel('high')
  await say(ada, 'Remind me to feed Miso.')
  await say(bo, 'Hi Bo.')

  const [toAda, toBo] = requests
  expect(toAda).toContain('You are Ada.')
  expect(toAda).toContain(defaultPersona)
  expect(toAda).toContain('Has a cat called Miso')
  expect(toBo).toContain('You are Bo.')
  expect(toBo).toContain('You’re a gardener.')
  expect(toBo).not.toContain('Miso')
  for (const request of [toAda, toBo]) {
    expect(request).toContain('Replies render as plain text.')
  }

  // A change of identity reaches the next request.
  await workspace.familiars.update(ada, { persona: 'You’re a vet.' })
  await say(ada, 'Hello again.')
  expect(requests.at(-1)).toContain('You’re a vet.')

  expect(
    (await read(() => familiar(bo).watch())).entries.some((entry) =>
      JSON.stringify(entry).includes('feed Miso'),
    ),
  ).toBe(false)
  expect(
    Object.keys((await read(() => familiar(ada).schedules.watch())) ?? {}),
  ).toHaveLength(1)
  expect((await read(() => familiar(bo).schedules.watch())) ?? {}).toEqual({})
  expect((await read(() => familiar(bo).memory.watch()))?.subjects).toEqual([])
  expect(
    (await read(() => familiar(ada).watch())).docs['pi.agent']?.thinkingLevel,
  ).toBe('high')
  expect(
    (await read(() => familiar(bo).watch())).docs['pi.agent']?.thinkingLevel,
  ).toBe('medium')

  expect(await workspace.familiars.list()).toEqual([
    { id: ada, name: 'Ada', persona: 'You’re a vet.' },
    { id: bo, name: 'Bo', persona: 'You’re a gardener.' },
  ])
  await expect(workspace.familiars.update(bo, { name: ' ' })).rejects.toThrow(
    'must not be blank',
  )
})

test("a Familiar is offered only the plugins it opted in to, from its next request, and new ones start with the workspace's defaults", async () => {
  // The tools each message's request offered, by the message.
  const offered = new Map<string, string[]>()
  const workspace = await openWorkspace({
    storage: new ReopenableStorage(),
    models: scriptedModels((request) => {
      if (request.type === 'message') {
        offered.set(request.text, offeredTools(request.context))
      }
      return fauxAssistantMessage('Hello.')
    }),
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'weather',
        title: 'Weather',
        tools: [
          defineTool({
            name: 'forecast',
            description: "Tomorrow's weather",
            parameters: schema.obj({}),
            execute: async () => ({ output: [{ type: 'text', text: 'Rain' }] }),
          }),
        ],
      }),
    ],
  })
  onTestFinished(() => workspace.dismiss())
  const say = async (familiar: WorkspaceFamiliar, text: string) => {
    const dm = (await workspace.rooms.get(
      await workspace.rooms.dm(familiar.id, 'aidan'),
    ))!
    const author = { id: 'aidan', name: 'Aidan' }
    await replyTo(dm, await dm.post({ author, text, requestId: text }))
    return offered.get(text)!
  }
  // A new Familiar opts in: none by default, or what its creator chose.
  const ada = await workspace.familiars.create({ name: 'Ada' })
  const bo = await workspace.familiars.create({
    name: 'Bo',
    capabilities: { plugins: ['weather'] },
  })
  expect(await ada.capabilities()).toEqual({ plugins: [], mcp: [] })
  expect(await bo.capabilities()).toEqual({ plugins: ['weather'], mcp: [] })
  await expect(ada.setCapabilities({ plugins: ['tides'] })).rejects.toThrow(
    CapabilityError,
  )

  const toAda = await say(ada, 'Ada, will it rain?')
  expect(toAda).not.toContain('forecast')
  // Core's own tools are always on.
  expect(toAda).toContain('recall')
  expect(await say(bo, 'Bo, will it rain?')).toContain('forecast')

  await ada.setCapabilities({ plugins: ['weather'] })
  expect(await say(ada, 'Ada, and now?')).toContain('forecast')

  // The workspace's defaults are what a Familiar made from now on starts with.
  await workspace.setDefaultCapabilities({ plugins: ['weather'] })
  const cy = await workspace.familiars.create({ name: 'Cy' })
  expect(await cy.capabilities()).toEqual({ plugins: ['weather'], mcp: [] })
})

test("a host's default tools fill in on the first open only, so a change made later is kept", async () => {
  const storage = new ReopenableStorage()
  const open = () =>
    openWorkspace({
      storage,
      models: scriptedModels(() => fauxAssistantMessage('Hello.')),
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [
        definePlugin({ name: 'weather', title: 'Weather', tools: [] }),
        definePlugin({ name: 'web', title: 'Web', tools: [] }),
      ],
      defaultCapabilities: { plugins: ['web'] },
    })
  const first = await open()
  expect(await first.defaultCapabilities()).toEqual({
    plugins: ['web'],
    mcp: [],
  })
  await first.setDefaultCapabilities({ plugins: ['weather'] })
  await first.dismiss()

  const reopened = await open()
  onTestFinished(() => reopened.dismiss())
  expect(await reopened.defaultCapabilities()).toEqual({
    plugins: ['weather'],
    mcp: [],
  })
})

test("a person's host name fills in on the first open only; the name they choose signs their messages from then on, in the log and what Familiars are shown", async () => {
  const storage = new ReopenableStorage()
  const shown: string[] = []
  const open = (name: string) =>
    openWorkspace({
      storage,
      models: scriptedModels((request) => {
        shown.push(JSON.stringify(request.context.messages.at(-1)))
        return fauxAssistantMessage('Hello.')
      }),
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      people: [{ id: 'aidan', name }],
    })
  // Whatever the host says each request's author is called.
  const author = { id: 'aidan', name: 'owner' }

  const first = await open('Owner')
  expect(await first.people.get(author)).toEqual({ id: 'aidan', name: 'Owner' })
  await first.people.rename('aidan', 'Aidan')
  await expect(first.people.rename('aidan', ' ')).rejects.toThrow(TypeError)
  await first.dismiss()

  const workspace = await open('Someone else')
  onTestFinished(() => workspace.dismiss())
  expect(await workspace.people.get(author)).toEqual({
    id: 'aidan',
    name: 'Aidan',
  })
  // Anyone else is called what the host says.
  expect(await workspace.people.get({ id: 'sam', name: 'Sam' })).toEqual({
    id: 'sam',
    name: 'Sam',
  })

  const ada = await workspace.familiars.create({ name: 'Ada' })
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(ada.id, 'aidan'),
  ))!
  const entry = await dm.post({ author, text: 'Hi', requestId: 'hi' })
  await replyTo(dm, entry)
  const [message] = (await read(() => dm.watch())).entries
  expect(message.data).toMatchObject({ author: { id: 'aidan', name: 'Aidan' } })
  expect(shown.at(-1)).toContain(
    '[Message from {\\"id\\":\\"aidan\\",\\"name\\":\\"Aidan\\"}]',
  )
})

test('a plugin opens with the Familiars that use it, hears each change, and closes with the workspace', async () => {
  const storage = new ReopenableStorage()
  const heard: number[][] = []
  let closed = 0
  const options = {
    storage,
    models: scriptedModels(() => fauxAssistantMessage('Hello.')),
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'computer',
        title: 'Computer',
        tools: [],
        open: ({ watchFamiliars }) => {
          watchFamiliars((familiars) => heard.push(familiars))
          return () => {
            closed++
          }
        },
      }),
    ],
  }
  const workspace = await openWorkspace(options)
  // What it was last told, once each change has been heard.
  const told = (familiars: number[]) =>
    expect.poll(() => heard.at(-1)).toEqual(familiars)
  await told([])

  const ada = await workspace.familiars.create({
    name: 'Ada',
    capabilities: { plugins: ['computer'] },
  })
  await told([ada.id])
  const bo = await workspace.familiars.create({ name: 'Bo' })
  await bo.setCapabilities({ plugins: ['computer'] })
  await told([ada.id, bo.id])
  await ada.setCapabilities({ plugins: [] })
  await told([bo.id])
  await workspace.familiars.remove(bo.id)
  await told([])
  await ada.setCapabilities({ plugins: ['computer'] })
  await told([ada.id])
  // Only when who uses it changed.
  expect(heard).toEqual([[], [ada.id], [ada.id, bo.id], [bo.id], [], [ada.id]])

  await workspace.dismiss()
  expect(closed).toBe(1)

  // Opening again reads who uses it from storage.
  heard.length = 0
  const reopened = await openWorkspace(options)
  onTestFinished(() => reopened.dismiss())
  await expect.poll(() => heard).toEqual([[ada.id]])
})

test('removing a Familiar deletes its saved logins, and if the store fails, the next open does', async () => {
  const store = memorySecrets()
  let failing = false
  const secrets = {
    ...store,
    delete: async (...args: Parameters<typeof store.delete>) =>
      failing ? Promise.reject(new Error('disk')) : store.delete(...args),
  }
  let secretsFor: ((familiar: FamiliarId) => FamiliarSecrets) | undefined
  const options = {
    storage: new ReopenableStorage(),
    secrets,
    models: scriptedModels(() => fauxAssistantMessage('Hello.')),
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'site',
        title: 'Site',
        tools: [],
        familiarSecrets: ['login'],
        open: (context) => {
          secretsFor = context.secretsFor
        },
      }),
    ],
  }
  const saved = (familiar: FamiliarId) =>
    store.get({ kind: 'plugin', name: 'site' }, `familiar/${familiar}/login`)
  const workspace = await openWorkspace(options)
  const ada = await workspace.familiars.create({ name: 'Ada' })
  await secretsFor!(ada.id).update('login', () => 'secret')

  failing = true
  await expect(workspace.familiars.remove(ada.id)).rejects.toThrow('disk')
  expect(await workspace.familiars.list()).toEqual([])
  await expect(
    secretsFor!(ada.id).update('login', () => 'again'),
  ).rejects.toThrow()
  expect(await saved(ada.id)).toBe('secret')
  await workspace.dismiss()

  failing = false
  const reopened = await openWorkspace(options)
  onTestFinished(() => reopened.dismiss())
  expect(await saved(ada.id)).toBeUndefined()
})

test('a plugin hears who uses it before resumed work reaches its tools', async () => {
  const storage = new ReopenableStorage()
  // What the plugin had heard when each call to its tool began.
  const heardAtCall: number[][][] = []
  let heard: number[][] = []
  let interrupted = false
  const options = {
    storage,
    models: scriptedModels((request) =>
      request.type === 'message'
        ? fauxAssistantMessage(fauxToolCall('look', {}), {
            stopReason: 'toolUse',
          })
        : fauxAssistantMessage('Looked.'),
    ),
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'computer',
        title: 'Computer',
        tools: [
          defineTool({
            name: 'look',
            description: 'Looks',
            parameters: schema.obj({}),
            replay: 'safe',
            execute: async (_args, _api, context) => {
              heardAtCall.push([...heard])
              if (!interrupted) {
                // Runs until the workspace stops it, as a restart would.
                const signal = context.abortSignal!
                await new Promise((_resolve, reject) =>
                  signal.addEventListener('abort', () => {
                    interrupted = true
                    reject(signal.reason)
                  }),
                )
              }
              return { output: [{ type: 'text' as const, text: 'Seen.' }] }
            },
          }),
        ],
        // Takes a while, as one that connects to something might.
        open: async ({ watchFamiliars }) => {
          heard = []
          await new Promise((resolve) => setTimeout(resolve, 100))
          watchFamiliars((familiars) => heard.push(familiars))
        },
      }),
    ],
  }
  const workspace = await openWorkspace(options)
  // Told before opening finishes.
  expect(heard).toEqual([[]])
  const ada = await workspace.familiars.create({
    name: 'Ada',
    capabilities: { plugins: ['computer'] },
  })
  const room = await workspace.rooms.dm(ada.id, 'aidan')
  const entry = await (await workspace.rooms.get(room))!.post({
    author: { id: 'aidan', name: 'Aidan' },
    text: 'Look',
    requestId: 'look',
  })
  await expect.poll(() => heardAtCall.length).toBe(1)
  await workspace.dismiss()

  // The next process replays the call it interrupted.
  const reopened = await openWorkspace(options)
  onTestFinished(() => reopened.dismiss())
  expect(heard).toEqual([[ada.id]])
  await replyTo((await reopened.rooms.get(room))!, entry)
  expect(heardAtCall).toEqual([[[], [ada.id]], [[ada.id]]])
})

test('every plugin closes even when one fails, before the workspace counts as closed', async () => {
  const order: string[] = []
  const plugin = (name: string, close: () => Promise<void>) =>
    definePlugin({ name, title: name, tools: [], open: () => close })
  const workspace = await openWorkspace({
    storage: new ReopenableStorage(),
    models: scriptedModels(() => fauxAssistantMessage('Hello.')),
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [
      plugin('first', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        order.push('first closed')
      }),
      plugin('second', async () => {
        throw new Error('second failed')
      }),
    ],
  })
  void workspace.closed.then(() => order.push('workspace closed'))

  await expect(workspace.dismiss()).rejects.toThrow(AggregateError)
  await workspace.closed
  expect(order).toEqual(['first closed', 'workspace closed'])
})
