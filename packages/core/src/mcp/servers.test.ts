import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { afterEach, expect, test } from 'vitest'
import {
  McpConfigError,
  memorySecrets,
  summonFamiliar,
  type Familiar,
  type McpConnectionInfo,
  type McpServer,
} from '../familiar.ts'
import { createHttpApi } from '../http/index.ts'
import { ReopenableStorage } from '../memory/testing.ts'

// Familiar saves any well-formed server and connects through the transport
// the host passed. Which protocols, destinations and commands are allowed is
// the host's to decide in that transport. Every transport here is a mock.

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

function setup() {
  const storage = new ReopenableStorage()
  const secrets = memorySecrets()
  const requests: Request[] = []
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  // Nothing answers, so a server that is tried fails.
  const mcpFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return new Response(null, { status: 503 })
  }
  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      secrets,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      mcpFetch,
    })
    opened.push(familiar)
    return familiar
  }
  const close = async (familiar: Familiar) => {
    opened.splice(opened.indexOf(familiar), 1)
    await familiar.dismiss()
  }
  return { storage, secrets, requests, faux, open, close }
}

const home: McpServer = {
  name: 'home',
  transport: {
    type: 'http',
    url: 'http://homeassistant.local:8123/api/mcp',
    auth: { type: 'bearer' },
  },
}

const statuses = async (familiar: Familiar) =>
  Object.fromEntries(
    (await familiar.connections.list()).map((info) => [
      info.name,
      (info as McpConnectionInfo).status,
    ]),
  )

test('a bearer server over plain HTTP waits for its token, then is tried with it', async () => {
  const f = setup()
  const familiar = await f.open()
  await familiar.mcp.add(home)
  await expect
    .poll(() => statuses(familiar))
    .toEqual({ home: { type: 'needs-auth' } })
  expect(f.requests).toEqual([])

  await familiar.connections.setSecret(
    { kind: 'mcp', name: 'home' },
    'token',
    'secret-token',
  )
  await expect
    .poll(() => statuses(familiar))
    .toMatchObject({ home: { type: 'failed' } })
  expect(f.requests[0]?.url).toBe('http://homeassistant.local:8123/api/mcp')
  expect(f.requests[0]?.headers.get('authorization')).toBe(
    'Bearer secret-token',
  )
})

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
    const f = setup()
    const familiar = await f.open()
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
    expect(f.requests).toEqual([])
  },
)
