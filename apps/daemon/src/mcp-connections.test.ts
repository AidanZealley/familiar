import { EventEmitter, once } from 'node:events'
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

test('a failed credential write restores the existing connection', async (test) => {
  const fixture = mcpFixture(test)
  const familiar = await fixture.open()
  await familiar.mcp.add(fixture.server)
  await familiar.connections.setSecret(connection, 'token', fixture.state.token)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  fixture.secrets.set = async () => {
    throw new Error('Credential store unavailable')
  }
  await expect(
    familiar.connections.setSecret(connection, 'token', 'replacement'),
  ).rejects.toThrow('Credential store unavailable')
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  expect((await info(familiar)).secrets).toMatchObject([{ set: true }])
})

test('a new declaration cannot reuse an orphaned token for a different endpoint', async (test) => {
  const fixture = mcpFixture(test)
  const familiar = await fixture.open()
  await fixture.secrets.set(connection, 'token', 'old-endpoint-token')
  await familiar.mcp.add({
    ...fixture.server,
    transport: {
      ...fixture.server.transport,
      url: 'http://different.local/mcp',
    },
  })
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('needs-auth')
  expect(await fixture.secrets.get(connection, 'token')).toBeUndefined()
  expect(fixture.state.requests).toEqual([])
})

test('parallel expired calls do not reconnect a replacement session', async (test) => {
  const fixture = mcpFixture(test)
  let expiredCalls = 0
  const familiar = await fixture.open(async (url, init) => {
    const request = new Request(url, init)
    const message =
      request.method === 'POST'
        ? ((await request.json()) as { method?: string })
        : undefined
    if (message?.method === 'tools/call') {
      expiredCalls++
      return new Response(null, { status: 404 })
    }
    return fixture.fetch(url, init)
  })
  await familiar.mcp.add(fixture.server)
  await familiar.connections.setSecret(connection, 'token', fixture.state.token)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  const events = new EventEmitter()
  const blocked = once(events, 'blocked')
  const released = once(events, 'released')
  test.onTestFinished(() => {
    events.emit('released')
  })
  const deleteSecret = fixture.secrets.delete
  fixture.secrets.delete = async (connection, secret) => {
    if (connection.name === 'other') {
      events.emit('blocked')
      await released
    }
    await deleteSecret(connection, secret)
  }
  // Keep an owner edit pending so both expiry callbacks queue before reconnect starts.
  const adding = familiar.mcp.add({ ...fixture.server, name: 'other' })
  await blocked
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      [
        fauxToolCall('mcp__test__echo', {}, { id: 'first' }),
        fauxToolCall('mcp__test__echo', {}, { id: 'second' }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Both calls failed.'),
  ])
  await familiar.send({
    author: 'owner',
    text: 'Echo twice.',
    requestId: 'parallel-expiry',
  })
  await familiar.idle()
  expect(expiredCalls).toBe(2)
  events.emit('released')
  await adding
  // This owner edit runs after the queued expiry callbacks: one automatic and one explicit reconnect.
  await familiar.mcp.reconnect('test')
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  expect(
    fixture.state.requests.filter(
      (request) =>
        request.method === 'POST' && !request.headers.has('mcp-session-id'),
    ),
  ).toHaveLength(3)
})

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

test.for(['dropResponse', 'expire', 'rejectCall', 'unauthorized'] as const)(
  'a failed call is not replayed after %s',
  async (failure, test) => {
    const fixture = mcpFixture(test)
    const familiar = await fixture.open()
    await familiar.mcp.add(fixture.server)
    await familiar.connections.setSecret(
      connection,
      'token',
      fixture.state.token,
    )
    await expect
      .poll(async () => (await info(familiar)).status.type)
      .toBe('connected')
    if (failure === 'unauthorized') {
      fixture.state.token = 'revoked'
    } else {
      fixture.state[failure] = true
    }
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
    expect(fixture.state.calls).toBe(
      failure === 'dropResponse' || failure === 'rejectCall' ? 1 : 0,
    )
    await expect
      .poll(async () => (await info(familiar)).status.type)
      .toBe(failure === 'unauthorized' ? 'needs-auth' : 'connected')
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
  await familiar.mcp.add(fixture.server)
  await familiar.connections.setSecret(connection, 'token', fixture.state.token)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('failed')
  expect(urls).toEqual([fixture.server.transport.url])
})
