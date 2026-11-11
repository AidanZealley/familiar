import type { TranscriptContext } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import {
  Server,
  WebStandardStreamableHTTPServerTransport,
  type CallToolRequest,
  type CallToolResult,
  type ServerContext,
  type Tool,
} from '@modelcontextprotocol/server'
import { expect, onTestFinished, test } from 'vitest'
import {
  McpConfigError,
  memorySecrets,
  type Workspace,
  type McpConnectionInfo,
  type McpServer,
  type PluginFetch,
} from '../index.ts'
import { createHttpApi } from '../http/index.ts'
import { offeredTools, replyTo, testHost, type TestHost } from '../testing.ts'

// Familiar saves any well-formed server and connects through the transport
// the host passed. Which protocols, destinations and commands are allowed is
// the host's to decide in that transport. These tests speak real Streamable
// HTTP to an MCP server in this process, through the `mcpFetch` they pass.

const echo: Tool = {
  name: 'echo',
  description: 'Echo a nested message.',
  inputSchema: {
    type: 'object',
    properties: { message: { $ref: '#/$defs/message' } },
    required: ['message'],
    $defs: {
      message: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
}

/**
 * An MCP server behind a bearer token, reached through `fetch`. It lists its
 * tools over two pages, echoes calls unless `state.call` answers them, and
 * fails the next call as each flag asks.
 */
function mcpServer() {
  const sessions = new Map<
    string,
    { server: Server; transport: WebStandardStreamableHTTPServerTransport }
  >()
  const state = {
    token: 'test-token',
    tools: [echo],
    calls: 0,
    call: undefined as
      | ((
          request: CallToolRequest,
          context: ServerContext,
        ) => Promise<CallToolResult>)
      | undefined,
    /** The next call runs, then its response is lost. */
    dropResponse: false,
    /** The next call finds its session gone. */
    expire: false,
    requests: [] as Request[],
  }
  const fetch: PluginFetch = async (input, init) => {
    const request = new Request(input, init)
    state.requests.push(request)
    if (request.headers.get('authorization') !== `Bearer ${state.token}`) {
      return new Response(null, { status: 401 })
    }
    const message =
      request.method === 'POST'
        ? ((await request.clone().json()) as { method?: string })
        : undefined
    if (state.expire && message?.method === 'tools/call') {
      state.expire = false
      return new Response(null, { status: 404 })
    }
    let session = sessions.get(request.headers.get('mcp-session-id') ?? '')
    if (!session) {
      const server = new Server(
        { name: 'test', version: '1.0.0' },
        { capabilities: { tools: { listChanged: true } } },
      )
      server.setRequestHandler('tools/list', ({ params }) =>
        params?.cursor
          ? { tools: state.tools }
          : { tools: [], nextCursor: 'page-two' },
      )
      server.setRequestHandler('tools/call', (request, context) => {
        state.calls++
        return (
          state.call?.(request, context) ?? {
            content: [{ type: 'text', text: JSON.stringify(request.params) }],
          }
        )
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })
      await server.connect(transport)
      session = { server, transport }
    }
    const response = await session.transport.handleRequest(request)
    if (session.transport.sessionId) {
      sessions.set(session.transport.sessionId, session)
    }
    if (state.dropResponse && message?.method === 'tools/call') {
      state.dropResponse = false
      await response.body?.cancel()
      throw new TypeError('Connection lost after execution')
    }
    return response
  }
  onTestFinished(async () => {
    await Promise.all(
      [...sessions.values()].map(({ server }) => server.close()),
    )
  })
  return {
    state,
    fetch,
    /** Tells every session its tools changed. */
    toolsChanged: () =>
      Promise.all(
        [...sessions.values()].map(({ server }) =>
          server.sendToolListChanged(),
        ),
      ),
  }
}

/** A promise and the function that settles it. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => (resolve = settle))
  return { promise, resolve }
}

const home = {
  name: 'test',
  transport: {
    type: 'http',
    url: 'http://homeassistant.local:8123/api/mcp',
    auth: { type: 'bearer' },
  },
} as const satisfies McpServer
const connection = { kind: 'mcp', name: 'test' } as const

const info = async (familiar: Workspace) =>
  (await familiar.connections.list())[0] as McpConnectionInfo
const status = async (familiar: Workspace) => (await info(familiar)).status.type

/** A Familiar over `fetch` with `home` connected by its token. */
/** Turns `name` on for the host's Familiar, which opts in to each connection. */
const use = (host: TestHost, name = home.name) =>
  host.familiar().setCapabilities({ mcp: [name] })

async function connected(
  server: ReturnType<typeof mcpServer>,
  fetch = server.fetch,
) {
  const host = await testHost({ secrets: memorySecrets(), mcpFetch: fetch })
  const familiar = host.workspace()
  await familiar.mcp.add(home)
  await use(host)
  await familiar.connections.setSecret(connection, 'token', server.state.token)
  await expect.poll(() => status(familiar)).toBe('connected')
  return host
}

const toolUse = (
  call: ReturnType<typeof fauxToolCall> | ReturnType<typeof fauxToolCall>[],
) => fauxAssistantMessage(call, { stopReason: 'toolUse' })
const searchFor = (query: string) =>
  toolUse(fauxToolCall('tool_search', { query }))
const callEcho = (text = 'Hello') =>
  toolUse(fauxToolCall('mcp__test__echo', { message: { text } }))

/** Runs `responses` as the model, returning every request it was sent. */
async function converse(
  host: TestHost,
  text: string,
  responses: ReturnType<typeof fauxAssistantMessage>[],
) {
  const requests: TranscriptContext[] = []
  host.faux.setResponses(
    responses.map((response) => (context) => {
      requests.push(context)
      return response
    }),
  )
  await host.say(text)
  return requests
}

const lastResult = (context: TranscriptContext | undefined) =>
  context?.messages.findLast((message) => message.role === 'toolResult')

/** What `tool_search` answers for `query`, asked as a new message each time. */
async function search(host: TestHost, query: string) {
  const requests = await converse(
    host,
    `Search ${query} ${crypto.randomUUID()}`,
    [searchFor(query), fauxAssistantMessage('Done.')],
  )
  return lastResult(requests[1])
}

test.each([
  { name: 'Not a name', transport: home.transport },
  { name: 'home', transport: { type: 'ftp', url: 'ftp://home.local/' } },
  {
    name: 'home',
    transport: { ...home.transport, url: 'https://user:pass@home.local/mcp' },
  },
  {
    name: 'home',
    transport: { ...home.transport, url: 'https://home.local/mcp?token=x' },
  },
])(
  'a malformed server is rejected and nothing is saved: %o',
  async (server) => {
    const requests: Request[] = []
    const host = await testHost({
      mcpFetch: async (input, init) => {
        requests.push(new Request(input, init))
        return new Response(null, { status: 503 })
      },
    })
    const familiar = host.workspace()
    await expect(
      familiar.mcp.add(server as unknown as McpServer),
    ).rejects.toBeInstanceOf(McpConfigError)
    const api = createHttpApi(familiar, {
      allow: () => true,
      authenticate: () => ({ id: 'owner', name: 'Owner' }),
    })
    const response = await api.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(server),
    })
    expect(response.status).toBe(400)
    expect(await familiar.connections.list()).toEqual([])
    expect(requests).toEqual([])
  },
)

test('a connection waits for its token, persists, follows tool changes and is cleaned up', async () => {
  const server = mcpServer()
  const secrets = memorySecrets()
  const host = await testHost({ secrets, mcpFetch: server.fetch })
  let familiar = host.workspace()

  // A bearer server sends nothing until it has its token.
  await familiar.mcp.add(home)
  await use(host)
  await expect.poll(() => status(familiar)).toBe('needs-auth')
  expect(server.state.requests).toEqual([])
  await familiar.connections.setSecret(connection, 'token', server.state.token)
  await expect.poll(() => status(familiar)).toBe('connected')
  expect((await info(familiar)).tools).toEqual([
    { name: 'echo', description: 'Echo a nested message.', readOnly: false },
  ])
  expect(
    server.state.requests.every(
      (request) => request.url === home.transport.url,
    ),
  ).toBe(true)

  // The server's own change notice refreshes the tools, and they survive a restart.
  server.state.tools = [
    {
      name: 'add',
      description: 'Add numbers',
      inputSchema: { type: 'object' },
    },
  ]
  await server.toolsChanged()
  await expect
    .poll(async () => (await info(familiar)).tools.map((tool) => tool.name))
    .toEqual(['add'])
  familiar = (await host.reopen()).workspace
  await expect.poll(() => status(familiar)).toBe('connected')
  expect((await info(familiar)).tools.map((tool) => tool.name)).toEqual(['add'])
  // The old session was ended rather than abandoned.
  expect(
    server.state.requests.some((request) => request.method === 'DELETE'),
  ).toBe(true)

  // A replaced token reconnects.
  await familiar.connections.deleteSecret(connection, 'token')
  await expect.poll(() => status(familiar)).toBe('needs-auth')
  server.state.token = 'replacement-token'
  await familiar.connections.setSecret(connection, 'token', server.state.token)
  await expect.poll(() => status(familiar)).toBe('connected')
  expect(await search(host, 'add')).toMatchObject({
    content: [
      { type: 'text', text: expect.stringContaining('mcp__test__add') },
    ],
  })

  // Removal takes its tools, the last server's tool search and its token
  // with it, for good.
  await familiar.mcp.remove('test')
  expect(await search(host, 'add')).toMatchObject({
    content: [
      {
        type: 'text',
        text: expect.stringContaining('tool_search is not available'),
      },
    ],
  })
  expect(await secrets.get(connection, 'token')).toBeUndefined()
  familiar = (await host.reopen()).workspace
  expect(await familiar.connections.list()).toEqual([])
})

test('a new declaration cannot reuse an orphaned token for a different endpoint', async () => {
  const server = mcpServer()
  const secrets = memorySecrets()
  const familiar = (
    await testHost({ secrets, mcpFetch: server.fetch })
  ).workspace()
  await secrets.set(connection, 'token', 'old-endpoint-token')
  await familiar.mcp.add({
    ...home,
    transport: { ...home.transport, url: 'http://different.local/mcp' },
  })
  await expect.poll(() => status(familiar)).toBe('needs-auth')
  expect(await secrets.get(connection, 'token')).toBeUndefined()
  expect(server.state.requests).toEqual([])
})

test('redirects fail without sending a bearer token to a different endpoint', async () => {
  const sent: [string, RequestRedirect | undefined][] = []
  const host = await testHost({
    secrets: memorySecrets(),
    // The host's fetch follows redirects unless told not to.
    mcpFetch: async (url, init) => {
      sent.push([String(url), init?.redirect])
      return Response.redirect('http://other.local/api/mcp')
    },
  })
  const familiar = host.workspace()
  await familiar.mcp.add(home)
  await familiar.connections.setSecret(connection, 'token', 'test-token')
  await expect.poll(() => status(familiar)).toBe('failed')
  // Either refuses to follow it: the token never reaches another endpoint.
  expect(sent).toEqual([
    [home.transport.url, expect.stringMatching(/^(error|manual)$/)],
  ])
})

test('deferred tools are found by search, checked against nested schemas and read back', async () => {
  const server = mcpServer()
  const host = await connected(server)
  const requests = await converse(host, 'Echo my message.', [
    searchFor('echo nested message'),
    callEcho('Hello from Familiar'),
    toolUse(fauxToolCall('mcp__test__echo', { message: {} })),
    fauxAssistantMessage('Done.'),
  ])

  const offered = (context: TranscriptContext) =>
    context.messages.flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []) : [],
    )
  expect(offered(requests[0]).map((tool) => tool.name)).not.toContain(
    'mcp__test__echo',
  )
  expect(
    offered(requests[1]).find((tool) => tool.name === 'mcp__test__echo')
      ?.parameters,
  ).toMatchObject({ $defs: { message: { type: 'object' } } })
  expect(lastResult(requests[2])).toMatchObject({
    isError: false,
    content: [
      { type: 'text', text: expect.stringContaining('Hello from Familiar') },
    ],
  })
  // The malformed call never reaches the server.
  expect(lastResult(requests[3])).toMatchObject({ isError: true })
  expect(server.state.calls).toBe(1)
})

// A remote call can act on the world, so one cut short is never run again.
test.for(['Stop', 'a restart'] as const)(
  'a remote call interrupted by %s is not run again',
  async (interruption) => {
    const server = mcpServer()
    const started = deferred()
    const cancelled = deferred()
    onTestFinished(cancelled.resolve)
    server.state.call = async (_request, context) => {
      context.mcpReq.signal.addEventListener('abort', cancelled.resolve, {
        once: true,
      })
      started.resolve()
      await cancelled.promise
      return { content: [{ type: 'text', text: 'Cancelled' }] }
    }
    const host = await connected(server)
    host.faux.setResponses([searchFor('echo'), callEcho()])
    const entry = await host.dm().post({
      author: { id: 'owner', name: 'owner' },
      text: 'Wait.',
      requestId: 'wait',
    })
    await started.promise
    if (interruption === 'Stop') {
      await host.dm().stop()
      // The server is told to stop, not just abandoned.
      await cancelled.promise
    } else {
      await host.reopen({}, async () =>
        host.faux.setResponses([fauxAssistantMessage('Recovered.')]),
      )
      await expect.poll(() => status(host.workspace())).toBe('connected')
    }
    await replyTo(host.dm(), entry)
    expect(server.state.calls).toBe(1)
  },
)

test.for(['dropResponse', 'expire', 'unauthorized'] as const)(
  'a failed call is not replayed after %s',
  async (failure) => {
    const server = mcpServer()
    const host = await connected(server)
    if (failure === 'unauthorized') {
      server.state.token = 'revoked'
    } else {
      server.state[failure] = true
    }
    const requests = await converse(host, 'Echo.', [
      searchFor('echo'),
      callEcho(),
      fauxAssistantMessage('The call failed.'),
    ])
    expect(lastResult(requests[2])).toMatchObject({ isError: true })
    // Only a lost response ran on the server, and it ran once.
    expect(server.state.calls).toBe(failure === 'dropResponse' ? 1 : 0)
    await expect
      .poll(() => status(host.workspace()))
      .toBe(failure === 'unauthorized' ? 'needs-auth' : 'connected')
  },
)

test('parallel expired calls do not reconnect a replacement session', async () => {
  const server = mcpServer()
  let expiredCalls = 0
  const secrets = memorySecrets()
  const host = await testHost({
    secrets,
    mcpFetch: async (url, init) => {
      const request = new Request(url, init)
      const message =
        request.method === 'POST'
          ? ((await request.json()) as { method?: string })
          : undefined
      if (message?.method === 'tools/call') {
        expiredCalls++
        return new Response(null, { status: 404 })
      }
      return server.fetch(url, init)
    },
  })
  const familiar = host.workspace()
  await familiar.mcp.add(home)
  await use(host)
  await familiar.connections.setSecret(connection, 'token', server.state.token)
  await expect.poll(() => status(familiar)).toBe('connected')

  // Keep an owner edit pending so both expiry callbacks queue before reconnect starts.
  const blocked = deferred()
  const released = deferred()
  onTestFinished(() => {
    released.resolve()
  })
  const deleteSecret = secrets.delete
  secrets.delete = async (connection, secret) => {
    if (connection.name === 'other') {
      blocked.resolve()
      await released.promise
    }
    await deleteSecret(connection, secret)
  }
  const adding = familiar.mcp.add({ ...home, name: 'other' })
  await blocked.promise
  await converse(host, 'Echo twice.', [
    searchFor('echo'),
    toolUse([
      fauxToolCall(
        'mcp__test__echo',
        { message: { text: 'a' } },
        { id: 'first' },
      ),
      fauxToolCall(
        'mcp__test__echo',
        { message: { text: 'b' } },
        { id: 'second' },
      ),
    ]),
    fauxAssistantMessage('Both calls failed.'),
  ])
  expect(expiredCalls).toBe(2)
  released.resolve()
  await adding
  // This owner edit runs after the queued expiry callbacks: one automatic and one explicit reconnect.
  await familiar.mcp.reconnect('test')
  await expect.poll(() => status(familiar)).toBe('connected')
  expect(
    server.state.requests.filter(
      (request) =>
        request.method === 'POST' && !request.headers.has('mcp-session-id'),
    ),
  ).toHaveLength(3)
})

test('an unavailable server neither blocks chat nor survives removal during startup', async () => {
  const host = await testHost({
    mcpFetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        )
      }),
  })
  const familiar = host.workspace()
  await familiar.mcp.add({
    ...home,
    transport: { ...home.transport, auth: { type: 'none' } },
  })
  await use(host)
  await converse(host, 'Hello.', [fauxAssistantMessage('Still here.')])
  await familiar.mcp.remove('test')
  expect(await familiar.connections.list()).toEqual([])
})

test('a Familiar with no MCP connection has no tool search', async () => {
  const host = await connected(mcpServer())
  const workspace = host.workspace()
  // Bo opts in to nothing; the host's Familiar uses the connection.
  const bo = await workspace.familiars.create({ name: 'Bo' })
  expect(await bo.capabilities()).toEqual({ plugins: [], mcp: [] })
  expect(await host.familiar().capabilities()).toEqual({
    plugins: [],
    mcp: ['test'],
  })

  const offered = async (
    dm: Awaited<ReturnType<typeof workspace.rooms.get>>,
  ) => {
    let tools: string[] = []
    host.faux.setResponses([
      (context) => {
        tools = offeredTools(context)
        return fauxAssistantMessage('Hello.')
      },
    ])
    const author = { id: 'aidan', name: 'Aidan' }
    const text = `Hello ${crypto.randomUUID()}`
    await replyTo(dm!, await dm!.post({ author, text, requestId: text }))
    return tools
  }
  const boDm = await workspace.rooms.get(
    await workspace.rooms.dm(bo.id, 'aidan'),
  )
  expect(await offered(boDm)).not.toContain('tool_search')
  expect(await offered(host.dm())).toContain('tool_search')
})
