import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, test, vi } from 'vitest'
import type { Author } from '../conversation/message.ts'
import type { Notification, NotificationContext } from '../familiar.ts'
import { fakeClock, fauxModels, testFamiliar } from '../testing.ts'
import {
  createHttpApi,
  type PushHost,
  type PushSubscriptionJson,
} from './index.ts'

const alice: Author = { id: 'alice', name: 'Alice' }
const bob: Author = { id: 'bob', name: 'Bob' }
const people = { alice, bob }

/** The host's session: who the `x-person` header says, if they're a member. */
const authenticate = (members: Author[]) => (request: Request) =>
  members.find((member) => member.id === request.headers.get('x-person'))

const subscription = (endpoint: string): PushSubscriptionJson => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
})

const as = (person: Author, method: string, body: unknown) =>
  new Request('http://host/push/subscriptions', {
    method,
    headers: { 'content-type': 'application/json', 'x-person': person.id },
    body: JSON.stringify(body),
  })

/**
 * One tenant's host: its own Familiar, members and push host, which records
 * what core hands it.
 */
async function tenant(members: Author[]) {
  const calls: [string, string, Author][] = []
  const push: PushHost = {
    publicKey: () => 'key',
    subscribe: async ({ endpoint }, subscriber) => {
      calls.push(['subscribe', endpoint, subscriber])
    },
    unsubscribe: async ({ endpoint }, subscriber) => {
      calls.push(['unsubscribe', endpoint, subscriber])
    },
  }
  const api = createHttpApi(await testFamiliar(), {
    authenticate: authenticate(members),
    routes: { push: { key: true, subscribe: true, unsubscribe: true } },
    push,
  })
  return { api, calls }
}

test('push hosts get the authenticated subscriber, per tenant, whatever the body says', async () => {
  const north = await tenant([alice, bob])
  const south = await tenant([alice])

  const phone = 'https://push.example/alice-phone'
  expect(
    (await north.api.request(as(alice, 'POST', subscription(phone)))).status,
  ).toBe(204)
  // Bob knows Alice's endpoint, and claims to be her in the body.
  expect(
    (
      await north.api.request(
        as(bob, 'DELETE', { ...subscription(phone), subscriber: alice }),
      )
    ).status,
  ).toBe(204)
  // Bob isn't a member of south, so its host never hears from him.
  expect(
    (await south.api.request(as(bob, 'DELETE', subscription(phone)))).status,
  ).toBe(401)
  expect(
    (await south.api.request(as(alice, 'POST', subscription(phone)))).status,
  ).toBe(204)

  expect(north.calls).toEqual([
    ['subscribe', phone, people.alice],
    // The host decides: it knows this is Bob, not Alice.
    ['unsubscribe', phone, people.bob],
  ])
  expect(south.calls).toEqual([['subscribe', phone, people.alice]])
})

test('a host delivers scheduled notifications through its own preferences, without push routes', async () => {
  // A Gather-like host: its members, their notification preferences and
  // its delivery system are its own. Familiar only reports the schedule.
  const members = [alice, bob]
  const preferences: Record<string, 'app' | 'off'> = {
    alice: 'off',
    bob: 'app',
  }
  const delivered: { to: string; body: string; requestedBy?: string }[] = []
  const notify = async (
    notification: Notification,
    context?: NotificationContext,
  ) => {
    for (const member of members) {
      if (preferences[member.id] === 'app') {
        delivered.push({
          to: member.id,
          body: notification.body,
          requestedBy: context?.creator?.name,
        })
      }
    }
  }

  const start = Date.UTC(2026, 9, 21, 12)
  const clock = fakeClock(start)
  const { faux, models } = fauxModels()
  const familiar = await testFamiliar({
    models,
    now: clock.now,
    setTimer: clock.setTimer,
    notify,
  })
  const api = createHttpApi(familiar, {
    authenticate: authenticate(members),
    routes: { conversation: { send: true }, push: { key: true } },
  })

  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('schedule', {
        prompt: 'Remind the house the bins go out',
        at: '2026-10-21 18:00',
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Will do.'),
    fauxAssistantMessage('Bins go out tonight.'),
  ])
  const sent = await api.request('/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-person': 'alice' },
    body: JSON.stringify({ text: 'Remind us about the bins', requestId: 'r1' }),
  })
  expect(sent.status).toBe(202)
  await familiar.idle()

  clock.advanceTo(Date.UTC(2026, 9, 21, 18))
  await vi.waitFor(() => expect(delivered).toHaveLength(1))

  // Bob wants them; Alice asked, but turned hers off.
  expect(delivered).toEqual([
    { to: 'bob', body: 'Bins go out tonight.', requestedBy: 'Alice' },
  ])
  // Familiar's browser push isn't involved.
  expect(
    (await api.request('/push/key', { headers: { 'x-person': 'alice' } }))
      .status,
  ).toBe(404)
})
