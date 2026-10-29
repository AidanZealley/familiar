import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import type { Familiar, McpConnectionInfo } from '@familiar/core'
import { createHttpApi } from '@familiar/core/http'
import { expect, test } from 'vitest'
import { mcpFixture } from './testing/mcp.ts'

const info = async (familiar: Familiar) =>
  (await familiar.connections.list())[0] as McpConnectionInfo
const connection = { kind: 'mcp', name: 'test' } as const

test('HTTP connections persist, keep tokens write-only, refresh tools and clean up', async (test) => {
  const fixture = mcpFixture(test)
  let familiar = await fixture.open()
  const api = createHttpApi(familiar, { authenticate: () => 'owner' })
  const add = await api.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.server),
  })
  expect(add.status).toBe(201)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('needs-auth')
  const set = await api.request('/connections/mcp/test/secrets/token', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: fixture.state.token }),
  })
  expect(set.status).toBe(204)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  const listed = await (await api.request('/connections')).json()
  expect(JSON.stringify(listed)).not.toContain(fixture.state.token)
  expect(listed).toMatchObject([{ secrets: [{ set: true }] }])
  expect(
    fixture.state.requests.every(
      (request) => request.url === fixture.server.transport.url,
    ),
  ).toBe(true)

  fixture.state.tools = [
    {
      name: 'add',
      description: 'Add numbers',
      inputSchema: { type: 'object' },
    },
  ]
  await fixture.notify()
  await expect
    .poll(async () => (await info(familiar)).tools.map((tool) => tool.name))
    .toEqual(['add'])
  await fixture.close(familiar)
  familiar = await fixture.open()
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  expect((await info(familiar)).tools.map((tool) => tool.name)).toEqual(['add'])
  expect(
    fixture.state.requests.some((request) => request.method === 'DELETE'),
  ).toBe(true)
  await familiar.connections.deleteSecret(connection, 'token')
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('needs-auth')
  fixture.state.token = 'replacement-token'
  await familiar.connections.setSecret(connection, 'token', fixture.state.token)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  expect(await fixture.search(familiar, 'add')).toMatchObject({
    content: [
      { type: 'text', text: expect.stringContaining('mcp__test__add') },
    ],
  })
  await familiar.mcp.remove('test')
  expect(await fixture.search(familiar, 'add')).toMatchObject({
    content: [
      { type: 'text', text: expect.stringContaining('No matching tools') },
    ],
  })
  expect(await familiar.connections.list()).toEqual([])
  expect(await fixture.secrets.get(connection, 'token')).toBeUndefined()
  await fixture.close(familiar)
  familiar = await fixture.open()
  expect(await familiar.connections.list()).toEqual([])
})

test.for(['dropResponse', 'expire'] as const)(
  'a failed call is not replayed after %s',
  async (failure, test) => {
    const fixture = mcpFixture(test)
    const familiar = await fixture.open()
    await fixture.secrets.set(connection, 'token', fixture.state.token)
    await familiar.mcp.add(fixture.server)
    await expect
      .poll(async () => (await info(familiar)).status.type)
      .toBe('connected')
    fixture.state[failure] = true
    const requests: TranscriptContext[] = []
    fixture.faux.setResponses(
      [
        fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(fauxToolCall('mcp__test__echo', {}), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage('The call failed.'),
      ].map((response) => (context) => {
        requests.push(context)
        return response
      }),
    )
    await familiar.send({ author: 'owner', text: 'Echo.', requestId: failure })
    await familiar.idle()
    expect(requests).toHaveLength(3)
    expect(requests[2].messages.at(-1)).toMatchObject({
      role: 'toolResult',
      isError: true,
    })
    expect(fixture.state.calls).toBe(failure === 'dropResponse' ? 1 : 0)
    if (failure === 'expire') {
      await expect
        .poll(async () => (await info(familiar)).status.type)
        .toBe('connected')
    } else {
      await expect
        .poll(async () => (await info(familiar)).status.type)
        .toBe('failed')
    }
  },
)

test('an unavailable server neither blocks chat nor survives removal during startup', async (test) => {
  const fixture = mcpFixture(test)
  const familiar = await fixture.open(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        )
      }),
  )
  await familiar.mcp.add({
    ...fixture.server,
    transport: { ...fixture.server.transport, auth: { type: 'none' } },
  })
  fixture.faux.setResponses([fauxAssistantMessage('Still here.')])
  await familiar.send({
    author: 'owner',
    text: 'Hello.',
    requestId: 'unavailable',
  })
  await familiar.idle()
  await familiar.mcp.remove('test')
  expect(await familiar.connections.list()).toEqual([])
})

test('redirects fail without sending a bearer token to a different endpoint', async (test) => {
  const fixture = mcpFixture(test)
  const urls: string[] = []
  const familiar = await fixture.open(async (url) => {
    urls.push(String(url))
    return Response.redirect('http://other.local/api/mcp')
  })
  await fixture.secrets.set(connection, 'token', fixture.state.token)
  await familiar.mcp.add(fixture.server)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('failed')
  expect(urls).toEqual([fixture.server.transport.url])
})
