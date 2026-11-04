import type { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import type { AccountApi } from '../account/index.ts'
import type { Author } from '../conversation/message.ts'
import type { Familiar } from '../familiar.ts'
import { createHttpApi, type RouteSelection } from './index.ts'
import { testFamiliar } from '../testing.ts'

/** The events a stream sends within `ms` of opening, and its whole text. */
async function stream(api: { request: Hono['request'] }, ms = 100) {
  const response = await api.request('/events')
  expect(response.status).toBe(200)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  const deadline = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), ms),
  )
  for (;;) {
    const chunk = await Promise.race([reader.read(), deadline])
    if (!chunk || chunk.done) {
      break
    }
    text += chunk.value
  }
  await reader.cancel()
  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map(
    ([, event, data]) =>
      event === 'document' ? `document ${JSON.parse(data).name}` : event,
  )
  return { events, text }
}

const member: Author = { id: 'sam', name: 'Sam' }

/** A Familiar whose account is signing in, showing its page and code. */
async function signingIn() {
  const state = vi.fn(() => ({
    status: 'signing-in' as const,
    url: 'https://login.example/device',
    code: 'WXYZ-1234',
  }))
  const onChange = vi.fn(() => () => {})
  const account = { state, onChange } as unknown as AccountApi
  const familiar: Familiar = { ...(await testFamiliar()), account }
  return { familiar, state, onChange }
}

// Widened for these runtime checks; the type tests own exact selections.
const api = (familiar: Familiar, routes: RouteSelection, as = member) =>
  createHttpApi(familiar, { authenticate: () => as, routes: routes as never })

test('each event source is chosen and checked on its own as a stream connects', async () => {
  const { familiar, state, onChange } = await signingIn()
  const owner = vi.fn((author: Author) => author.id === 'owner')
  const watchMemory = vi.spyOn(familiar.memory, 'watch')
  const watchSchedules = vi.spyOn(familiar.schedules, 'watch')

  // Account routes don't stream the account, and refused sources open nothing.
  const seen = await stream(
    api(familiar, {
      account: { state: owner, signIn: owner },
      events: {
        conversation: true,
        schedules: true,
        memory: owner,
        account: owner,
      },
    }),
  )
  expect(seen.events).toEqual(['protocol', 'view', 'document schedules'])
  expect(seen.text).not.toContain('login.example')
  expect(seen.text).not.toContain('WXYZ')
  expect(owner).toHaveBeenCalledTimes(2)
  expect(watchMemory).not.toHaveBeenCalled()
  expect(state).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
  expect(watchSchedules).toHaveBeenCalledOnce()

  // The same selection streams the owner everything it chose.
  const theirs = await stream(
    api(
      familiar,
      { events: { conversation: true, memory: owner, account: owner } },
      { id: 'owner', name: 'Owner' },
    ),
  )
  expect(theirs.events).toEqual([
    'protocol',
    'view',
    'document memory',
    'account',
  ])
  expect(theirs.text).toContain('login.example')

  // Refused every chosen source, a stream is refused.
  const refused = api(familiar, { events: { account: owner } })
  expect((await refused.request('/events')).status).toBe(403)
})

test.each<[string, RouteSelection]>([
  ['`events: true`', { events: true }],
  ['`true`', true],
])('%s streams every source', async (_name, routes) => {
  const { familiar } = await signingIn()
  expect((await stream(api(familiar, routes))).events).toEqual([
    'protocol',
    'view',
    'document memory',
    'document episodes',
    'document schedules',
    'account',
  ])
})
