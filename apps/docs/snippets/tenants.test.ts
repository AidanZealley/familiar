import type { Author } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { expect, test, vi } from 'vitest'
import { createTenantsHost, type Member } from './tenants.ts'

const alice: Author = { id: 'alice', name: 'Alice' }
const bob: Author = { id: 'bob', name: 'Bob' }
const carol: Author = { id: 'carol', name: 'Carol' }
const sessions: Record<string, Member> = {
  alice: { author: alice, tenant: 'north' },
  bob: { author: bob, tenant: 'north' },
  carol: { author: carol, tenant: 'south' },
}

const replies: Record<string, string> = {
  north: 'Will do.',
  south: 'Hello, Carol.',
}

test('the session chooses the tenant, and tenants never see each other', async () => {
  const opened: string[] = []
  const host = createTenantsHost({
    member: async (request) => sessions[request.headers.get('x-person') ?? ''],
    workspace: (tenant) => {
      opened.push(tenant)
      const faux = fauxProvider({ models: [{ id: 'demo' }] })
      const models = createModels()
      models.setProvider(faux.provider)
      faux.setResponses([fauxAssistantMessage(replies[tenant])])
      return {
        storage: new MemoryStorage(),
        models,
        model: { provider: 'faux', modelId: 'demo' },
        timeZone: 'Europe/London',
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
  /** The person's tenant's shared room. */
  const room = async (person: string) =>
    ((await (await as(person, '/rooms')).json()) as { id: number }[])[0].id
  const send = async (person: string, text: string) =>
    as(person, `/rooms/${await room(person)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, requestId: text }),
    })
  const history = async (person: string) =>
    JSON.stringify(
      await (
        await as(person, `/rooms/${await room(person)}/history?before=1000000`)
      ).json(),
    )

  try {
    expect((await send('alice', 'Remind us about the bins')).status).toBe(202)
    expect((await send('carol', 'Hello')).status).toBe(202)
    expect((await as('mallory', '/rooms')).status).toBe(401)

    // Bob shares Alice's room; Carol, in south, never sees it.
    await vi.waitFor(async () => {
      expect(await history('bob')).toContain('Will do.')
      expect(await history('carol')).toContain('Hello, Carol.')
    })
    expect(await history('carol')).not.toContain('bins')
    expect(opened).toEqual(['north', 'south'])
  } finally {
    await host.dismiss()
  }
})
