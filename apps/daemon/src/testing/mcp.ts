import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { Message } from '@earendil-works/pi-ai'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import {
  memorySecrets,
  summonFamiliar,
  type Familiar,
  type PluginFetch,
} from '@familiar/core'
import {
  Server,
  WebStandardStreamableHTTPServerTransport,
  type Tool,
} from '@modelcontextprotocol/server'
import type { TestContext } from 'vitest'

/** Real Streamable HTTP messages, with fetch routed in-process instead of opening sockets. */
export function mcpFixture(test: TestContext) {
  const sessions = new Map<
    string,
    { server: Server; transport: WebStandardStreamableHTTPServerTransport }
  >()
  const state = {
    token: 'test-token',
    tools: [
      {
        name: 'echo',
        description: 'Echo a message',
        inputSchema: { type: 'object' },
      },
    ] as Tool[],
    calls: 0,
    dropResponse: false,
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
      server.setRequestHandler('tools/list', () => ({ tools: state.tools }))
      server.setRequestHandler('tools/call', ({ params }) => {
        state.calls++
        return { content: [{ type: 'text', text: JSON.stringify(params) }] }
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
  test.onTestFinished(async () => {
    await Promise.all(
      [...sessions.values()].map(({ server }) => server.close()),
    )
  })
  const directory = mkdtempSync(join(tmpdir(), 'familiar-mcp-test-'))
  test.onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const secrets = memorySecrets()
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const opened = new Set<Familiar>()
  test.onTestFinished(async () => {
    await Promise.all([...opened].map((familiar) => familiar.dismiss()))
  })
  const open = async (mcpFetch: PluginFetch = fetch) => {
    const familiar = await summonFamiliar({
      storage: await openNodeSqliteStorage(join(directory, 'test.sqlite')),
      secrets,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      mcpFetch,
    })
    opened.add(familiar)
    return familiar
  }
  const close = async (familiar: Familiar) => {
    await familiar.dismiss()
    opened.delete(familiar)
  }
  return {
    state,
    fetch,
    open,
    close,
    secrets,
    faux,
    search: async (familiar: Familiar, query: string) => {
      let result: Message | undefined
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('tool_search', { query }), {
          stopReason: 'toolUse',
        }),
        (context) => {
          result = context.messages.findLast(
            (message) => message.role === 'toolResult',
          )
          return fauxAssistantMessage('Done.')
        },
      ])
      await familiar.send({
        author: 'owner',
        text: query,
        requestId: crypto.randomUUID(),
      })
      await familiar.idle()
      return result
    },
    notify: async () => {
      await Promise.all(
        [...sessions.values()].map(({ server }) =>
          server.sendToolListChanged(),
        ),
      )
    },
    server: {
      name: 'test',
      transport: {
        type: 'http',
        url: 'http://homeassistant.local:8123/api/mcp',
        auth: { type: 'bearer' },
      },
    } as const,
  }
}
