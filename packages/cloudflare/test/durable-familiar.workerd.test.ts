import { localMinute } from '@familiar-ai/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from 'wrangler'
import { SLOW_REPLY } from './model.ts'

// DurableFamiliar in workerd, through the test Worker beside this file: what
// it promises across eviction, reloads and termination. Its heartbeat is a
// second, so lost work resumes within seconds.
const ZONE = 'Europe/London'
const HEARTBEAT_MS = 1_000

let server: TestHarness

beforeAll(async () => {
  server = createTestHarness({
    root: import.meta.dirname,
    workers: [{ configPath: './wrangler.jsonc' }],
  })
  await server.listen()
})

afterAll(() => server?.close())

const send = (bot: string, text: string) =>
  server.fetch(`/${bot}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
  })

type Status = {
  status: 'open' | 'terminated'
  alarm: number | null
  wake?: { active: boolean; at?: number }
}

const status = async (bot: string) =>
  (await (await server.fetch(`/${bot}/status`)).json()) as Status

type Message = {
  role: string
  content: { type: string; text?: string }[]
  stopReason?: string
  timestamp?: number
  durationMs?: number
}

/** Everything the bot's model said, oldest first. */
const replies = async (bot: string) => {
  const response = await server.fetch(
    `/${bot}/api/history?before=${Number.MAX_SAFE_INTEGER}`,
  )
  expect(response.status).toBe(200)
  const { entries } = (await response.json()) as {
    entries: { model?: Message[] }[]
  }
  return entries
    .toReversed()
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === 'assistant')
}

const textOf = (message: Message) =>
  message.content.map((part) => part.text ?? '').join('')

const notifications = async (bot: string) =>
  (await (await server.fetch(`/${bot}/notifications`)).json()) as string[]

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

test('a reply settles the alarm on the next upkeep pass', async () => {
  expect((await send('fresh', 'hello')).status).toBe(202)
  const { wake } = await settled('fresh')
  expect((await replies('fresh')).map(textOf)).toEqual(['You said: hello'])
  // Upkeep's nightly pass is the only sleep a new Familiar has.
  expect(localMinute(wake!.at!, ZONE)).toMatch(/ 04:00$/)
  expect(wake!.at).toBeGreaterThan(Date.now())
})

test('a reminder fires from its alarm after the object is evicted', async () => {
  // Whole minutes, far enough ahead to evict before it's due.
  const due = Math.ceil((Date.now() + 15_000) / 60_000) * 60_000
  await send('reminder', `remind ${localMinute(due, ZONE)} stretch`)
  expect((await settled('reminder')).alarm).toBe(due)

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
  expect(textOf((await replies('reminder')).at(-1)!)).toBe('Reminder: stretch')
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

  // Untouched long enough for the heartbeat alarm to restart the object and
  // the reply, about six seconds at the stream's pace, to stream again in full.
  await sleep(10_000)
  const touched = Date.now()
  const [cut, retried, ...rest] = await replies('interrupted')
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

  expect(
    (await server.fetch('/ended/terminate', { method: 'POST' })).status,
  ).toBe(204)
  expect(await status('ended')).toEqual({ status: 'terminated', alarm: null })
  expect((await send('ended', 'hello?')).status).toBe(410)
  expect((await server.fetch('/ended/api/history?before=1')).status).toBe(410)

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
    server.fetch('/race/terminate', { method: 'POST' }),
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
