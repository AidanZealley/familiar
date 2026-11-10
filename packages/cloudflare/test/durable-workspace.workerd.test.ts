import { localMinute } from '@familiar-ai/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from 'wrangler'
import { REMINDER, SLOW_REPLY } from './model.ts'

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

type Status = { alarm: number | null; instance: string }

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
 * The alarm once nothing runs: a sleep, not a heartbeat. A request arms a
 * heartbeat first, which its alarm then settles.
 */
const settled = async (bot: string) => {
  await expect
    .poll(
      async () => {
        const { alarm } = await status(bot)
        return alarm !== null && alarm > Date.now() + 5 * HEARTBEAT_MS
      },
      { timeout: 15_000, interval: 200 },
    )
    .toBe(true)
  return (await status(bot)).alarm!
}

const evict = (bot: string) =>
  server.getWorker().evictDurableObject('Bot', { name: bot })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('a reminder fires from its alarm, whether the object was evicted or stayed in memory', async () => {
  // Whole minutes, far enough ahead to evict before it's due.
  const due = Math.ceil((Date.now() + 15_000) / 60_000) * 60_000
  for (const bot of ['evicted', 'live']) {
    await send(bot, `remind ${localMinute(due, ZONE)} stretch`)
    expect(await settled(bot)).toBe(due)
  }
  const { instance } = await status('live')

  await evict('evicted')
  // The outbox is its own object: polling it doesn't start the evicted bot.
  // Polling the live bot's status keeps it in memory, so its alarm finds
  // the Familiar already open and must resume the reminder itself.
  await expect
    .poll(
      async () => [
        await notifications('evicted'),
        await notifications('live'),
        (await status('live')).instance,
      ],
      { timeout: due - Date.now() + 30_000, interval: 1_000 },
    )
    .toEqual([[REMINDER], [REMINDER], instance])

  // Upkeep's nightly pass is then the only sleep left.
  expect(localMinute(await settled('evicted'), ZONE)).toMatch(/ 04:00$/)
  expect(textOf((await replies('evicted')).at(-1)!)).toBe(REMINDER)
})

test('work cut off by a reload resumes from the heartbeat alarm', async () => {
  await send('interrupted', 'slow')
  // The request armed a heartbeat before its reply started.
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
  expect((await status('ended')).alarm).toBeNull()
  expect((await send('ended', 'hello?')).status).toBe(410)
  expect((await server.fetch('/ended/api/history?before=1')).status).toBe(410)

  // A new instance reads the record and opens nothing.
  await evict('ended')
  expect((await send('ended', 'hello again?')).status).toBe(410)
  expect((await status('ended')).alarm).toBeNull()

  const storage = await server
    .getWorker()
    .getDurableObjectStorage('Bot', { name: 'ended' })
  const [{ count }] = (await storage.exec(
    "SELECT count(*) AS count FROM pi_entries WHERE record ->> '$.kind' = 'familiar.message'",
  )) as { count: number }[]
  expect(count).toBe(2)
})
