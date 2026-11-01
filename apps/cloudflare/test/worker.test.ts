import { localMinute } from '@familiar-ai/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from 'wrangler'
import { SLOW_REPLY } from '../src/model.ts'

// The Worker runs in workerd from wrangler.jsonc, as `wrangler dev` runs it,
// with a short heartbeat so lost work resumes within seconds.
const TOKEN = crypto.randomUUID()
const ZONE = 'Europe/London'
const HEARTBEAT_MS = 1_000
const root = new URL('..', import.meta.url).pathname

let server: TestHarness

beforeAll(async () => {
  server = createTestHarness({
    root,
    workers: [
      {
        configPath: './wrangler.jsonc',
        vars: { HEARTBEAT_MS: String(HEARTBEAT_MS), TIME_ZONE: ZONE },
        secrets: { FAMILIAR_DEV_TOKEN: TOKEN },
      },
    ],
  })
  await server.listen()
})

afterAll(() => server?.close())

const auth = { authorization: `Bearer ${TOKEN}` }

const get = (path: string) => server.fetch(path, { headers: auth })

const send = (bot: string, text: string) =>
  server.fetch(`/bots/${bot}/api/messages`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
  })

type Status = {
  status: 'open' | 'terminated'
  alarm: number | null
  wake?: { active: boolean; at?: number }
}

const status = async (bot: string) =>
  (await (await get(`/bots/${bot}/status`)).json()) as Status

type Entry = {
  kind: string
  data?: { text?: string }
  model?: {
    role: string
    content: { type: string; text?: string }[]
    stopReason?: string
    timestamp?: number
    durationMs?: number
  }[]
}

const entries = async (bot: string): Promise<Entry[]> => {
  const response = await get(
    `/bots/${bot}/api/history?before=${Number.MAX_SAFE_INTEGER}`,
  )
  expect(response.status).toBe(200)
  return ((await response.json()) as { entries: Entry[] }).entries.toReversed()
}

const replies = async (bot: string) =>
  (await entries(bot)).flatMap((entry) =>
    (entry.model ?? [])
      .filter((message) => message.role === 'assistant')
      .map((message) =>
        message.content.map((part) => part.text ?? '').join(''),
      ),
  )

const notifications = async (bot: string) =>
  (
    (await (await get(`/bots/${bot}/notifications`)).json()) as {
      body: string
    }[]
  ).map(({ body }) => body)

/**
 * Nothing running, and the alarm exactly what the Familiar needs. A request
 * arms a heartbeat first, which its alarm then settles.
 */
const settled = async (bot: string) => {
  await expect
    .poll(
      async () => {
        const { status: state, alarm, wake } = await status(bot)
        return { state, active: wake?.active, matches: alarm === wake?.at }
      },
      { timeout: 15_000, interval: 200 },
    )
    .toEqual({ state: 'open', active: false, matches: true })
  return status(bot)
}

const evict = (bot: string) =>
  server.getWorker().evictDurableObject('Bot', { name: bot })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('every route needs the token', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    expect((await server.fetch('/bots/a/status', { headers })).status).toBe(401)
    expect(
      (await server.fetch('/bots/a/api/history?before=1', { headers })).status,
    ).toBe(401)
    expect((await server.fetch('/elsewhere', { headers })).status).toBe(401)
  }
  expect((await get('/elsewhere')).status).toBe(404)
})

test('without a configured token, nothing is served', async () => {
  const closed = createTestHarness({
    root,
    workers: [
      { configPath: './wrangler.jsonc', secrets: { FAMILIAR_DEV_TOKEN: '' } },
    ],
  })
  await closed.listen()
  try {
    const response = await closed.fetch('/bots/a/status', {
      headers: { authorization: 'Bearer anything' },
    })
    expect(response.status).toBe(401)
  } finally {
    await closed.close()
  }
})

test('a new bot arms its alarm for upkeep once idle', async () => {
  const { wake } = await settled('fresh')
  // Upkeep's nightly pass is the only sleep a new Familiar has.
  expect(localMinute(wake!.at!, ZONE)).toMatch(/ 04:00$/)
  expect(wake!.at).toBeGreaterThan(Date.now())
})

test('chats through the HTTP API, and each name is its own Familiar', async () => {
  expect((await send('one', 'hello from one')).status).toBe(202)
  expect((await send('two', 'hello from two')).status).toBe(202)
  await settled('one')
  await settled('two')
  expect(await replies('one')).toEqual(['You said: hello from one'])
  expect(await replies('two')).toEqual(['You said: hello from two'])
})

test('a reminder fires from its alarm after the object is evicted', async () => {
  // Whole minutes, far enough ahead to evict before it's due.
  const due = Math.ceil((Date.now() + 15_000) / 60_000) * 60_000
  await send('reminder', `remind ${localMinute(due, ZONE)} stretch`)
  const before = await settled('reminder')
  expect(before.alarm).toBe(due)

  await evict('reminder')
  // The outbox is its own object: polling it doesn't start the bot.
  await expect
    .poll(() => notifications('reminder'), {
      timeout: due - Date.now() + 30_000,
      interval: 1_000,
    })
    .toEqual(['Reminder: stretch'])

  const after = await settled('reminder')
  expect(localMinute(after.alarm!, ZONE)).toMatch(/ 04:00$/)
  expect((await replies('reminder')).at(-1)).toBe('Reminder: stretch')
})

test('work cut off by a reload resumes from the heartbeat alarm', async () => {
  await send('interrupted', 'slow')
  await expect
    .poll(() => status('interrupted'), { interval: 100 })
    .toMatchObject({ wake: { active: true } })
  expect((await status('interrupted')).alarm).toBeLessThanOrEqual(
    Date.now() + HEARTBEAT_MS,
  )
  await sleep(500)
  // Reloading the Worker, as a deploy does, drops every live object midway.
  // (Eviction is gentler: it waits for the reply to finish.)
  await server.update((options) => ({ ...options }))
  const reloaded = Date.now()

  // Untouched long enough for the alarm to restart the object and the reply
  // to stream again in full.
  await sleep(20_000)
  const touched = Date.now()
  const [cut, retried, ...rest] = (await entries('interrupted'))
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === 'assistant')
  expect(rest).toEqual([])
  expect(cut).toMatchObject({ stopReason: 'aborted' })
  expect(retried).toMatchObject({
    stopReason: 'stop',
    content: [{ type: 'text', text: SLOW_REPLY }],
  })
  // Streamed again after the reload, and finished before this test touched
  // the object again.
  expect(retried.timestamp).toBeGreaterThan(reloaded)
  expect(retried.timestamp! + retried.durationMs!).toBeLessThan(touched)
  await settled('interrupted')
})

test('a terminated bot stays terminated, keeps its history and has no alarm', async () => {
  const due = Date.now() + 10 * 60_000
  await send('ended', `remind ${localMinute(due, ZONE)} stretch`)
  await settled('ended')
  await send('ended', 'slow')

  const terminated = await server.fetch('/bots/ended/terminate', {
    method: 'POST',
    headers: auth,
  })
  expect(terminated.status).toBe(204)
  expect(await status('ended')).toEqual({ status: 'terminated', alarm: null })
  expect((await send('ended', 'hello?')).status).toBe(410)
  expect((await get('/bots/ended/api/history?before=1')).status).toBe(410)

  // A new instance reads the record and opens nothing.
  await evict('ended')
  expect((await send('ended', 'hello again?')).status).toBe(410)
  expect(await status('ended')).toEqual({ status: 'terminated', alarm: null })

  const storage = await server
    .getWorker()
    .getDurableObjectStorage('Bot', { name: 'ended' })
  const [{ count }] = (await storage.exec(
    "SELECT count(*) AS count FROM pi_entries WHERE record ->> '$.kind' = 'familiar.message'",
  )) as { count: number }[]
  expect(count).toBe(2)
})

test('termination wins over requests racing it', async () => {
  await send('race', 'first')
  await settled('race')
  const [terminated, ...sends] = await Promise.all([
    server.fetch('/bots/race/terminate', { method: 'POST', headers: auth }),
    ...Array.from({ length: 5 }, (_, i) => send('race', `racing ${i}`)),
  ])
  expect(terminated.status).toBe(204)
  for (const response of sends) {
    expect([202, 410]).toContain(response.status)
  }
  expect((await send('race', 'after')).status).toBe(410)
  await sleep(2 * HEARTBEAT_MS)
  expect(await status('race')).toEqual({ status: 'terminated', alarm: null })
})

test('oversized bodies are refused before forwarding, including streams without Content-Length', async () => {
  const body = JSON.stringify({
    text: 'x'.repeat(65 * 1024),
    requestId: 'large',
  })
  const headers = { ...auth, 'content-type': 'application/json' }
  const url = '/bots/body-limit/api/messages'
  expect(
    (await server.fetch(url, { method: 'POST', headers, body })).status,
  ).toBe(413)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  expect(
    (
      await server.fetch(url, {
        method: 'POST',
        headers,
        body: stream,
        duplex: 'half',
      } as Parameters<TestHarness['fetch']>[1])
    ).status,
  ).toBe(413)
})
