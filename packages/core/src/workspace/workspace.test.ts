import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, onTestFinished, test } from 'vitest'
import { openMemory, rememberFact } from '../memory/facts.ts'
import { withHarness } from '../memory/testing.ts'
import { scriptedModels } from '../models/scripted.ts'
import { ReopenableStorage } from '../testing.ts'
import { createFamiliar } from './familiars.ts'
import { openWorkspace } from './index.ts'

const read = async <T>(
  watch: () => Promise<{ value: T; stop(): Promise<unknown> }>,
) => {
  const opened = await watch()
  await opened.stop()
  return opened.value
}

test('Familiars in one workspace each keep their own chat, memory, schedules, model level and name', async () => {
  const storage = new ReopenableStorage()
  // Ada remembers Miso, as her upkeep would have filed it; Bo knows nothing.
  const { ada, bo } = await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const ada = await createFamiliar(tx, 'Ada')
      const bo = await createFamiliar(tx, 'Bo')
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
  })
  onTestFinished(() => workspace.dismiss())

  const familiar = (id: typeof ada) => workspace.familiars.get(id)!
  const say = async (id: typeof ada, text: string) => {
    await familiar(id).send({
      author: { id: 'aidan', name: 'Aidan' },
      text,
      requestId: text,
    })
    await familiar(id).idle()
  }

  await familiar(ada).setThinkingLevel('high')
  await say(ada, 'Remind me to feed Miso.')
  await say(bo, 'Hi Bo.')

  const [toAda, toBo] = requests
  expect(toAda).toContain('You are Ada')
  expect(toAda).toContain('Has a cat called Miso')
  expect(toBo).toContain('You are Bo')
  expect(toBo).not.toContain('Miso')

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
    { id: ada, name: 'Ada' },
    { id: bo, name: 'Bo' },
  ])
})
