import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage, type DocumentWatch } from '@earendil-works/pi-durable'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { afterEach, expect, test, vi } from 'vitest'
import { summonFamiliar, type Familiar } from './familiar.ts'
import {
  conversationRoutes,
  eventRoutes,
  createHttpApi,
  type FactsState,
} from './http.ts'
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
  while (!text.includes('event: account\n')) {
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    text += chunk.value
  }
  await reader.cancel()

  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map(
    ([, event, data]) =>
      event === 'document'
        ? JSON.parse(data)
        : event === 'protocol'
          ? { event, data: JSON.parse(data) }
          : { event },
  )
  expect(events).toEqual([
    { event: 'protocol', data: { version: 1 } },
    { event: 'view' },
    { name: 'memory', value: { facts: [], next: 1 } },
    { name: 'episodes', value: { episodes: [], next: 1 } },
    { name: 'schedules', value: {} },
    { event: 'account' },
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

test('hosts compose groups and enforce middleware before mutations', async () => {
  const send = vi.fn(async () => {})
  const abort = vi.fn(async () => {})
  const history = vi.fn(async () => ({ entries: [], more: false }))
  const app = new Hono()
    .use('/chat/*', async (c, next) => {
      if (c.req.header('authorization') !== 'member') {
        return c.json({ error: 'forbidden' }, 403)
      }
      await next()
    })
    .route(
      '/chat',
      conversationRoutes({ send, abort, history }, () => 'Sam'),
    )
  const body = { text: 'Hello', requestId: 'one', author: 'Spoofed' }
  const request = (authorized: boolean) =>
    app.request('/chat/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { authorization: 'member' } : {}),
      },
      body: JSON.stringify(body),
    })
  expect((await request(false)).status).toBe(403)
  expect(send).not.toHaveBeenCalled()
  expect((await app.request('/chat/abort', { method: 'POST' })).status).toBe(
    403,
  )
  expect(abort).not.toHaveBeenCalled()
  expect((await request(true)).status).toBe(202)
  expect(send).toHaveBeenCalledWith({
    author: 'Sam',
    text: 'Hello',
    requestId: 'one',
  })
  for (const path of [
    '/memory/health',
    '/account',
    '/model/options',
    '/events',
  ]) {
    expect((await app.request(path)).status).toBe(404)
  }
})

test('restricted events open only selected watches and clean up on cancel and reconnect', async () => {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
  })
  opened.push(familiar)
  const omitted = [
    vi.spyOn(familiar.memory, 'watch'),
    vi.spyOn(familiar.memory, 'watchEpisodes'),
    vi.spyOn(familiar.schedules, 'watch'),
  ]
  const stops: ReturnType<typeof vi.fn>[] = []
  const watch = vi.fn(async () => {
    const source = await familiar.watch()
    const stop = vi.fn(() => source.stop())
    stops.push(stop)
    return {
      value: source.value,
      closed: source.closed,
      start: source.start.bind(source),
      stop,
    }
  })
  const app = eventRoutes({ conversation: watch })
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request('/events')
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader()
    let text = ''
    while (!text.includes('event: view\n')) {
      const chunk = await reader.read()
      expect(chunk.done).toBe(false)
      text += chunk.value
    }
    expect(
      [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]),
    ).toEqual(['protocol', 'view'])
    await reader.cancel()
    await vi.waitFor(() => expect(stops[attempt]).toHaveBeenCalledTimes(1))
  }
  expect(watch).toHaveBeenCalledTimes(2)
  for (const open of omitted) {
    expect(open).not.toHaveBeenCalled()
  }
})

test('empty and account-only streams send only explicit sources and stop listeners', async () => {
  const stop = vi.fn()
  const state = vi.fn(() => ({ status: 'signed-out' as const }))
  const onChange = vi.fn(() => stop)
  for (const sources of [
    {},
    { account: { state, onChange } },
    { account: null },
  ]) {
    const app = eventRoutes(sources)
    const response = await app.request('/events')
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader()
    let text = ''
    const expected = 'account' in sources ? 2 : 1
    while ((text.match(/^event:/gm) ?? []).length < expected) {
      const chunk = await reader.read()
      expect(chunk.done).toBe(false)
      text += chunk.value
    }
    expect(
      [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]),
    ).toEqual(expected === 1 ? ['protocol'] : ['protocol', 'account'])
    if (sources.account) {
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    }
    await reader.cancel()
  }
  expect(state).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(stop).toHaveBeenCalledTimes(1)
})

test('selected watch closure ends the stream and clears heartbeat and account listener', async () => {
  const clear = vi.spyOn(globalThis, 'clearInterval')
  let close!: () => void
  const closed = new Promise<{ reason: 'stopped' }>((resolve) => {
    close = () => resolve({ reason: 'stopped' })
  })
  const stop = vi.fn(async () => ({ reason: 'stopped' as const }))
  const stopAccount = vi.fn()
  const app = eventRoutes({
    memory: async () => ({ value: null, start: vi.fn(), stop, closed }),
    account: {
      state: () => ({ status: 'signed-out' }),
      onChange: () => stopAccount,
    },
  })
  const response = await app.request('/events')
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  while (!text.includes('event: account\n')) {
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    text += chunk.value
  }
  close()
  while (!(await reader.read()).done) {
    /* Drain until the selected watch closes the response. */
  }
  expect(stop).toHaveBeenCalledTimes(1)
  expect(stopAccount).toHaveBeenCalledTimes(1)
  expect(clear).toHaveBeenCalledWith(expect.anything())
  clear.mockRestore()
})

test('disconnect during watch opening stops the late watch without starting it', async () => {
  let opened!: (watch: DocumentWatch<FactsState>) => void
  const opening = new Promise<DocumentWatch<FactsState>>((resolve) => {
    opened = resolve
  })
  const open = vi.fn(() => opening)
  const app = eventRoutes({ memory: open })
  const response = await app.request('/events')
  const reader = response.body!.getReader()
  await reader.read()
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  await reader.cancel()
  const stop = vi.fn(async () => ({ reason: 'stopped' as const }))
  const start = vi.fn()
  opened({ value: null, start, stop, closed: new Promise(() => {}) })
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  expect(start).not.toHaveBeenCalled()
})
