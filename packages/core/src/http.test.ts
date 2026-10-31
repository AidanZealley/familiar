import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { testClient } from 'hono/testing'
import { afterEach, expect, test } from 'vitest'
import { summonFamiliar, type Familiar } from './familiar.ts'
import { createHttpApi } from './http.ts'
import { storageWith } from './memory/testing.ts'

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

test('memory routes edit facts and refuse missing or past ones', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: await storageWith(['Lives in Leeds', 4], ['Likes blue pens', 1]),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
  })
  opened.push(familiar)

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
    (await call('PUT', '/memory/f1', { text: 'Lives in York' })).status,
  ).toBe(204)
  expect((await call('PUT', '/memory/f2/pin', { pinned: true })).status).toBe(
    204,
  )
  expect((await call('POST', '/memory/f3/retire')).status).toBe(204)
  const past = await call('PUT', '/memory/f1', { text: 'Again' })
  expect(past.status).toBe(404)
  expect(await past.json()).toEqual({
    error: 'f1 is already past; only current facts can change.',
  })
  // Nothing deletes a fact.
  expect((await call('DELETE', '/memory/f2')).status).toBe(404)
  const health = await call('GET', '/memory/health')
  expect(health.status).toBe(200)
  expect(await health.json()).toMatchObject({
    facts: { current: 1, past: 2 },
    episodes: { day: 0, week: 0, month: 0 },
  })
  expect((await call('PUT', '/memory/f2/pin', { pinned: 'yes' })).status).toBe(
    400,
  )

  const watch = await familiar.memory.watch()
  await watch.stop()
  expect(watch.value?.facts).toMatchObject([
    { id: 'f1', until: expect.any(String) },
    { id: 'f2', core: true, pinned: true },
    {
      id: 'f3',
      text: 'Lives in York',
      replaces: ['f1'],
      until: expect.any(String),
    },
  ])
})

test('the event stream sends the view and every document whole first', async () => {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
  })
  opened.push(familiar)
  const api = createHttpApi(familiar, { authenticate: () => 'aidan' })

  const response = await api.request('/events')
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  while ((text.match(/event: document\n/g) ?? []).length < 2) {
    text += (await reader.read()).value
  }
  await reader.cancel()

  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map(
    ([, event, data]) => (event === 'document' ? JSON.parse(data) : { event }),
  )
  expect(events).toEqual([
    { event: 'view' },
    { name: 'memory', value: { facts: [], next: 1 } },
    { name: 'episodes', value: { episodes: [], next: 1 } },
  ])
})

test('messages and history validate what clients send', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
  })
  opened.push(familiar)
  faux.setResponses([fauxAssistantMessage('Hello.')])
  const client = testClient(
    createHttpApi(familiar, { authenticate: () => 'aidan' }),
  )

  const sent = await client.messages.$post({
    json: { text: 'Hi', requestId: 'hi' },
  })
  expect(sent.status).toBe(202)
  await familiar.idle()

  const blank = await client.messages.$post({
    json: { text: ' ', requestId: 'blank' },
  })
  expect(blank.status).toBe(400)

  const unbounded = await client.history.$get({ query: { before: 'latest' } })
  expect(unbounded.status).toBe(400)

  const response = await client.history.$get({
    query: { before: String(Number.MAX_SAFE_INTEGER) },
  })
  if (!response.ok) {
    throw new Error(`history failed: ${response.status}`)
  }
  const page = await response.json()
  // The whole conversation fits in one page, newest first.
  expect(page.entries.map((entry) => entry.kind)).toEqual([
    'pi.assistant',
    'pi.system',
    'familiar.message',
  ])
  // The author is whoever the host authenticates.
  expect(page.entries[2].data).toEqual({ author: 'aidan', text: 'Hi' })
  expect(page.more).toBe(false)
})
