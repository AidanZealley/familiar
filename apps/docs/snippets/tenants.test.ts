import type { Author, FamiliarOptions } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { expect, test, vi } from 'vitest'
import { notifyTenant, type Notifications } from './notify.ts'
import { createTenantsHost, type Member } from './tenants.ts'

const alice: Author = { id: 'alice', name: 'Alice' }
const bob: Author = { id: 'bob', name: 'Bob' }
const carol: Author = { id: 'carol', name: 'Carol' }
const sessions: Record<string, Member> = {
  alice: { author: alice, tenant: 'north' },
  bob: { author: bob, tenant: 'north' },
  carol: { author: carol, tenant: 'south' },
}

/** A clock the test moves, so a schedule comes due on demand. */
function testClock(start: number) {
  let now = start
  let timers: { due: number; fire: () => void }[] = []
  const setTimer: FamiliarOptions['setTimer'] = (
    fire,
    delay,
    { background },
  ) => {
    if (background) {
      return undefined
    }
    const timer = { due: now + delay, fire }
    timers.push(timer)
    return () => {
      timers = timers.filter((other) => other !== timer)
    }
  }
  const advanceTo = (time: number) => {
    now = time
    const due = timers.filter((timer) => timer.due <= now)
    timers = timers.filter((timer) => timer.due > now)
    due.forEach((timer) => timer.fire())
  }
  return { now: () => now, setTimer, advanceTo }
}

const scripts = {
  north: [
    fauxAssistantMessage(
      fauxToolCall('schedule', {
        prompt: 'Remind the team the bins go out',
        at: '2026-10-21 18:00',
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Will do.'),
    fauxAssistantMessage('Bins go out tonight.'),
  ],
  south: [fauxAssistantMessage('Hello, Carol.')],
}

test('each tenant has its own Familiar, and its own notification audience', async () => {
  const clock = testClock(Date.UTC(2026, 9, 21, 12))
  const opened: string[] = []
  const delivered: { to: string; body: string; requestedBy?: string }[] = []
  // The app's own preferences: in north, only Bob wants reminders.
  const app: Notifications = {
    recipients: async (tenant) => (tenant === 'north' ? [bob] : [carol]),
    send: async (to, { body, requestedBy }) => {
      delivered.push({ to: to.id, body, requestedBy })
    },
  }
  const host = createTenantsHost({
    member: async (request) => sessions[request.headers.get('x-person') ?? ''],
    familiar: (tenant) => {
      opened.push(tenant)
      const faux = fauxProvider({ models: [{ id: 'demo' }] })
      const models = createModels()
      models.setProvider(faux.provider)
      faux.setResponses(scripts[tenant as keyof typeof scripts])
      return {
        storage: new MemoryStorage(),
        models,
        model: { provider: 'faux', modelId: 'demo' },
        timeZone: 'Europe/London',
        now: clock.now,
        setTimer: clock.setTimer,
        notify: notifyTenant(tenant, app),
      }
    },
  })
  const as = (person: string, path: string, init: RequestInit = {}) =>
    host.fetch(
      new Request(`https://host.example${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-person': person },
      }),
    )
  const send = (person: string, text: string) =>
    as(person, '/messages', {
      method: 'POST',
      body: JSON.stringify({ text, requestId: text }),
    })
  const history = async (person: string) =>
    JSON.stringify(await (await as(person, '/history?before=1000000')).json())

  try {
    expect((await send('alice', 'Remind us about the bins')).status).toBe(202)
    expect((await send('carol', 'Hello')).status).toBe(202)
    expect((await as('mallory', '/history?before=1')).status).toBe(401)

    // Bob shares Alice's conversation; Carol, in south, never sees it.
    await vi.waitFor(async () => {
      expect(await history('bob')).toContain('Will do.')
      expect(await history('carol')).toContain('Hello, Carol.')
    })
    expect(await history('carol')).not.toContain('bins')
    expect(opened).toEqual(['north', 'south'])

    clock.advanceTo(Date.UTC(2026, 9, 21, 18))
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    // North's app chose Bob; Alice asked, so she's the attribution.
    expect(delivered).toEqual([
      { to: 'bob', body: 'Bins go out tonight.', requestedBy: 'Alice' },
    ])
  } finally {
    await host.dismiss()
  }
})

test('dismiss closes healthy tenants even when another tenant failed to open', async () => {
  const broken = new MemoryStorage()
  const healthy = new MemoryStorage()
  const failure = new Error('storage unavailable')
  vi.spyOn(broken, 'commit').mockRejectedValue(failure)
  const closed = vi.spyOn(healthy, 'close')
  const faux = fauxProvider({ models: [{ id: 'demo' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const host = createTenantsHost({
    member: async (request) => ({
      author: alice,
      tenant: new URL(request.url).hostname,
    }),
    familiar: (tenant) => ({
      storage: tenant === 'broken' ? broken : healthy,
      models,
      model: { provider: 'faux', modelId: 'demo' },
      timeZone: 'UTC',
    }),
  })
  await expect(
    host.fetch(new Request('https://broken/history?before=1')),
  ).rejects.toThrow('storage unavailable')
  expect(
    (await host.fetch(new Request('https://healthy/history?before=1'))).status,
  ).toBe(200)
  await expect(host.dismiss()).rejects.toBeInstanceOf(AggregateError)
  expect(closed).toHaveBeenCalledOnce()
})
