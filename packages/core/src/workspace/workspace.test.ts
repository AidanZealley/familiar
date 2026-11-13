import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, onTestFinished, test } from 'vitest'
import { openMemory, rememberFact } from '../memory/facts.ts'
import { withHarness } from '../memory/testing.ts'
import { scriptedModels } from '../models/scripted.ts'
import { definePlugin, defineTool, Type } from '../index.ts'
import { offeredTools, ReopenableStorage, replyTo } from '../testing.ts'
import { createFamiliar } from './familiars.ts'
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
  // Ada remembers Miso, as her upkeep would have filed it; Bo knows nothing
  // but has a persona of his own.
  const { ada, bo } = await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const ada = await createFamiliar(tx, { name: 'Ada' })
      const bo = await createFamiliar(tx, {
        name: 'Bo',
        persona: 'You are Bo, a gardener.',
      })
      rememberFact(
        await openMemory(tx, ada),
        {
          text: 'Has a cat called Miso',
          importance: 4,
          since: '2026-11-02',
          sources: [],
        },
        Date.now(),
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
  expect(toAda).toContain(defaultPersona('Ada'))
  expect(toAda).toContain('Has a cat called Miso')
  expect(toBo).toContain('You are Bo, a gardener.')
  expect(toBo).not.toContain('Miso')
  for (const request of [toAda, toBo]) {
    expect(request).toContain('Replies render as plain text.')
  }

  // A change of identity reaches the next request.
  await workspace.familiars.update(ada, { persona: 'You are Ada, a vet.' })
  await say(ada, 'Hello again.')
  expect(requests.at(-1)).toContain('You are Ada, a vet.')

  expect(
    (await read(() => familiar(bo).watch())).entries.some((entry) =>
      JSON.stringify(entry).includes('feed Miso'),
    ),
  ).toBe(false)
  expect(
    Object.keys((await read(() => familiar(ada).schedules.watch())) ?? {}),
  ).toHaveLength(1)
  expect((await read(() => familiar(bo).schedules.watch())) ?? {}).toEqual({})
  expect((await read(() => familiar(bo).memory.watch()))?.facts ?? []).toEqual(
    [],
  )
  expect(
    (await read(() => familiar(ada).watch())).docs['pi.agent']?.thinkingLevel,
  ).toBe('high')
  expect(
    (await read(() => familiar(bo).watch())).docs['pi.agent']?.thinkingLevel,
  ).toBe('medium')

  expect(await workspace.familiars.list()).toEqual([
    { id: ada, name: 'Ada', persona: 'You are Ada, a vet.' },
    { id: bo, name: 'Bo', persona: 'You are Bo, a gardener.' },
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
            parameters: Type.Object({}),
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
