import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, expect, test } from 'vitest'
import {
  McpConfigError,
  memorySecrets,
  summonFamiliar,
  type Familiar,
  type McpConnectionInfo,
  type McpServer,
  type McpStdioFactory,
} from '../familiar.ts'
import { createHttpApi } from '../http.ts'
import { ReopenableStorage, withHarness } from '../memory/testing.ts'
import { McpServers } from './servers.ts'

// Admission: what Familiar will connect to. Every transport here is a mock
// that records what reached it, so a refusal can show nothing was sent.

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

function setup() {
  const storage = new ReopenableStorage()
  const secrets = memorySecrets()
  const requests: Request[] = []
  const launched: string[] = []
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  // Nothing answers, so an admitted server fails; only a refused one is refused.
  const mcpFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return new Response(null, { status: 503 })
  }
  const mcpStdio: McpStdioFactory = ({ command }) => {
    launched.push(command)
    return InMemoryTransport.createLinkedPair()[0]
  }
  const open = async (
    host: { http?: boolean; stdio?: boolean } = { http: true },
  ) => {
    const familiar = await summonFamiliar({
      storage,
      secrets,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      ...(host.http && { mcpFetch }),
      ...(host.stdio && { mcpStdio }),
    })
    opened.push(familiar)
    return familiar
  }
  const close = async (familiar: Familiar) => {
    opened.splice(opened.indexOf(familiar), 1)
    await familiar.dismiss()
  }
  return { storage, secrets, requests, launched, open, close }
}

const bearer = (url: string): McpServer => ({
  name: 'home',
  transport: { type: 'http', url, auth: { type: 'bearer' } },
})

const status = async (familiar: Familiar) =>
  ((await familiar.connections.list())[0] as McpConnectionInfo | undefined)
    ?.status

test.each([
  'http://homeassistant.local:8123/api/mcp',
  'http://192.168.1.20/mcp',
  // A tailnet name or address gets no exception for being one.
  'http://machine.tail1234.ts.net/mcp',
  'http://100.101.102.103/mcp',
  'http://localhost.evil.example/mcp',
])(
  'a bearer server over plain HTTP is refused before it is saved: %s',
  async (url) => {
    const f = setup()
    const familiar = await f.open()
    const connection = { kind: 'mcp', name: 'home' } as const
    await f.secrets.set(connection, 'token', 'kept')
    await expect(familiar.mcp.add(bearer(url))).rejects.toBeInstanceOf(
      McpConfigError,
    )
    const api = createHttpApi(familiar, {
      authenticate: () => ({ id: 'owner', name: 'Owner' }),
    })
    const response = await api.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bearer(url)),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: expect.stringContaining('only sent over HTTPS'),
    })
    expect(await familiar.connections.list()).toEqual([])
    // Refused before anything changed, including an orphaned secret.
    expect(await f.secrets.get(connection, 'token')).toBe('kept')
    expect(f.requests).toEqual([])
    await f.close(familiar)
    expect(await (await f.open()).connections.list()).toEqual([])
  },
)

test.each([
  bearer('https://homeassistant.local:8123/api/mcp'),
  // The explicit development exception: this machine only.
  bearer('http://localhost:8123/mcp'),
  bearer('http://127.0.0.1:8123/mcp'),
  bearer('http://127.1.2.3/mcp'),
  bearer('http://[::1]:8123/mcp'),
  // No token, so nothing to protect.
  {
    name: 'home',
    transport: {
      type: 'http',
      url: 'http://nas.local:8080/mcp',
      auth: { type: 'none' },
    },
  } satisfies McpServer,
])('an admissible server is saved: $transport.url', async (server) => {
  const f = setup()
  const familiar = await f.open()
  await familiar.mcp.add(server)
  await expect
    .poll(() => status(familiar))
    .not.toMatchObject({
      type: 'refused',
    })
})

test('a host without a transport refuses servers that need it before saving them', async () => {
  const f = setup()
  const stdio: McpServer = {
    name: 'local',
    transport: { type: 'stdio', command: 'uvx', args: [] },
  }
  const withoutStdio = await f.open({ http: true })
  await expect(withoutStdio.mcp.add(stdio)).rejects.toThrow(
    'This host does not run local MCP commands.',
  )
  await f.close(withoutStdio)
  const withoutHttp = await f.open({ stdio: true })
  await expect(
    withoutHttp.mcp.add(bearer('https://homeassistant.local/mcp')),
  ).rejects.toThrow('This host has no MCP HTTP transport.')
  expect(await withoutHttp.connections.list()).toEqual([])
  expect(f.launched).toEqual([])
})

test('oversized server fields are refused before saving', async () => {
  const f = setup()
  const familiar = await f.open({ http: true, stdio: true })
  await expect(
    familiar.mcp.add(
      bearer(`https://homeassistant.local/${'a'.repeat(2_100)}`),
    ),
  ).rejects.toThrow('2048 characters')
  await expect(
    familiar.mcp.add({
      name: 'local',
      transport: {
        type: 'stdio',
        command: 'node',
        args: Array.from({ length: 65 }, () => 'x'),
      },
    }),
  ).rejects.toThrow('64 arguments')
  expect(await familiar.connections.list()).toEqual([])
  expect(f.launched).toEqual([])
})

test('servers saved under looser rules stay visible as refused, never connect, and do not block startup', async () => {
  const f = setup()
  // Saved by a version without these rules, then opened by a host without stdio.
  await withHarness(f.storage, (harness) =>
    harness.commit(async (tx) => {
      const doc = await tx.doc(McpServers)
      doc.servers.push(bearer('http://homeassistant.local:8123/api/mcp'), {
        name: 'local',
        transport: { type: 'stdio', command: 'uvx', args: [] },
      })
    }, BACKGROUND_CONTEXT),
  )
  const connection = { kind: 'mcp', name: 'home' } as const
  await f.secrets.set(connection, 'token', 'secret-token')
  const familiar = await f.open({ http: true })

  const statuses = async () =>
    (await familiar.connections.list()).map((info) => [
      info.name,
      (info as McpConnectionInfo).status,
    ])
  const refused = [
    [
      'home',
      {
        type: 'refused',
        error: expect.stringContaining('only sent over HTTPS'),
      },
    ],
    [
      'local',
      { type: 'refused', error: 'This host does not run local MCP commands.' },
    ],
  ]
  await expect.poll(statuses).toEqual(refused)

  // Reconnecting, or a new token, checks again rather than connecting.
  await familiar.mcp.reconnect('home')
  await familiar.mcp.reconnect('local')
  await familiar.connections.setSecret(connection, 'token', 'replacement')
  await expect.poll(statuses).toEqual(refused)
  expect(f.requests).toEqual([])

  // Still the owner's to remove.
  await familiar.mcp.remove('home')
  await familiar.mcp.remove('local')
  expect(await familiar.connections.list()).toEqual([])
})
