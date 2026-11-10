import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, onTestFinished, test } from 'vitest'
import { openMemory, rememberFact } from '../memory/facts.ts'
import { withHarness } from '../memory/testing.ts'
import { scriptedModels } from '../models/scripted.ts'
import { ReopenableStorage, replyTo } from '../testing.ts'
import { createFamiliar } from './familiars.ts'
import { openWorkspace } from './index.ts'
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
    model: { provider: 'faux', modelId: 'sol' },
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
