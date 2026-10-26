import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import { summonFamiliar, type Familiar } from './familiar.ts'
import { createHttpApi } from './http.ts'

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

test('memory routes edit facts and refuse missing or past ones', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
  })
  opened.push(familiar)
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
        fauxToolCall('remember', { text: 'Likes blue pens', importance: 1 }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await familiar.send({ author: 'aidan', text: 'Hi', requestId: 'hi' })
  await familiar.idle()

  const api = createHttpApi(familiar, { authenticate: () => 'aidan' })
  const call = (method: string, path: string, body?: unknown) =>
    api.request(path, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })

  expect(
    (await call('PUT', '/memory/m1', { text: 'Lives in York' })).status,
  ).toBe(204)
  expect((await call('PUT', '/memory/m2/pin', { pinned: true })).status).toBe(
    204,
  )
  expect((await call('POST', '/memory/m3/retire')).status).toBe(204)
  const past = await call('PUT', '/memory/m1', { text: 'Again' })
  expect(past.status).toBe(404)
  expect(await past.json()).toEqual({
    error: 'm1 is already past; only current facts can change.',
  })
  expect((await call('DELETE', '/memory/m9')).status).toBe(404)
  expect((await call('PUT', '/memory/m2/pin', { pinned: 'yes' })).status).toBe(
    400,
  )
  expect((await call('DELETE', '/memory/m1')).status).toBe(204)

  const watch = await familiar.memory.watch()
  await watch.stop()
  expect(watch.value?.facts).toMatchObject([
    { id: 'm2', core: true, pinned: true },
    {
      id: 'm3',
      text: 'Lives in York',
      replaces: ['m1'],
      until: expect.any(Number),
    },
  ])
})
