import { EventEmitter, once } from 'node:events'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { summonFamiliar } from '@familiar-ai/core'
import { serve } from '@hono/node-server'
import {
  Server,
  WebStandardStreamableHTTPServerTransport,
  type CallToolResult,
  type CallToolRequest,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { expect, test, type TestContext } from 'vitest'

async function setup(
  test: TestContext,
  call: (
    request: CallToolRequest,
    context: ServerContext,
  ) => Promise<CallToolResult>,
) {
  const server = new Server(
    { name: 'test', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  const pages: (string | undefined)[] = []
  server.setRequestHandler('tools/list', ({ params }) => {
    pages.push(params?.cursor)
    return params?.cursor
      ? {
          tools: [
            {
              name: 'echo',
              description: 'Echo the nested message from the test server.',
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
            },
          ],
        }
      : { tools: [], nextCursor: 'page-two' }
  })
  server.setRequestHandler('tools/call', call)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })
  await server.connect(transport)
  test.onTestFinished(() => server.close())
  const http = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => transport.handleRequest(request),
  })
  test.onTestFinished(async () => {
    if ('closeAllConnections' in http) {
      http.closeAllConnections()
    }
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    )
  })
  await new Promise<void>((resolve) => http.on('listening', resolve))
  const address = http.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected an HTTP port.')
  }
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    mcpFetch: async (input, init) => fetch(input, init),
  })
  test.onTestFinished(() => familiar.dismiss())
  await familiar.mcp.add({
    name: 'test',
    transport: {
      type: 'http',
      auth: { type: 'none' },
      url: `http://127.0.0.1:${address.port}/mcp`,
    },
  })
  await expect
    .poll(async () => {
      const connections = await familiar.connections.list()
      const connection = connections.find(
        (connection) => connection.kind === 'mcp' && connection.name === 'test',
      )
      return connection?.kind === 'mcp' ? connection.status.type : undefined
    })
    .toBe('connected')
  return { familiar, faux, pages }
}

test('Familiar discovers deferred HTTP tools, validates nested schemas and reads results', async (test) => {
  const calls: unknown[] = []
  const { familiar, faux, pages } = await setup(test, async (request) => {
    calls.push(request.params)
    return {
      content: [],
      structuredContent: { echoed: request.params },
    } satisfies CallToolResult
  })
  expect(pages).toEqual([undefined, 'page-two'])
  const requests: TranscriptContext[] = []
  faux.setResponses(
    [
      fauxAssistantMessage(
        fauxToolCall('tool_search', { query: 'echo nested message' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        fauxToolCall('mcp__test__echo', {
          message: { text: 'Hello from Familiar' },
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxToolCall('mcp__test__echo', { message: {} }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Done.'),
    ].map((response) => (context) => {
      requests.push(context)
      return response
    }),
  )
  await familiar.send({
    author: 'owner',
    text: 'Echo my message.',
    requestId: 'echo',
  })
  await familiar.idle()
  expect(requests).toHaveLength(4)
  const toolsOffered = (context: TranscriptContext) =>
    context.messages.flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []) : [],
    )
  expect(
    toolsOffered(requests[0]).some((tool) => tool.name === 'mcp__test__echo'),
  ).toBe(false)
  expect(
    toolsOffered(requests[1]).find((tool) => tool.name === 'mcp__test__echo')
      ?.parameters,
  ).toMatchObject({ $defs: { message: { type: 'object' } } })
  expect(requests[2].messages.at(-1)).toMatchObject({
    role: 'toolResult',
    isError: false,
    content: [
      { type: 'text', text: expect.stringContaining('Hello from Familiar') },
    ],
  })
  expect(requests[3].messages.at(-1)).toMatchObject({
    role: 'toolResult',
    isError: true,
  })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    name: 'echo',
    arguments: { message: { text: 'Hello from Familiar' } },
  })
})

test('Stop cancels a remote tool without repeating its call', async (test) => {
  const events = new EventEmitter()
  const started = once(events, 'started')
  const cancelled = once(events, 'cancelled')
  let calls = 0
  const { familiar, faux } = await setup(test, async (_request, context) => {
    calls++
    context.mcpReq.signal.addEventListener(
      'abort',
      () => events.emit('cancelled'),
      {
        once: true,
      },
    )
    events.emit('started')
    await cancelled
    return { content: [{ type: 'text', text: 'Cancelled' }] }
  })
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      fauxToolCall('mcp__test__echo', { message: { text: 'Wait' } }),
      { stopReason: 'toolUse' },
    ),
  ])
  await familiar.send({
    author: 'owner',
    text: 'Wait for cancellation.',
    requestId: 'cancel',
  })
  await started
  await familiar.abort()
  await cancelled
  await familiar.idle()
  expect(calls).toBe(1)
})
