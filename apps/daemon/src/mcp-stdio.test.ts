import { fileURLToPath } from 'node:url'
import { EventEmitter, once } from 'node:events'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  summonFamiliar,
  memorySecrets,
  type Familiar,
  type McpConnectionInfo,
  type McpServer,
} from '@familiar/core'
import { createHttpApi } from '@familiar/core/http'
import { afterEach, expect, test, vi } from 'vitest'
import { stdioTransport } from './mcp-stdio.ts'

const opened = new Set<Familiar>()
const close = async (familiar: Familiar) => {
  opened.delete(familiar)
  await familiar.dismiss()
}
afterEach(async () => {
  await Promise.all([...opened].map(close))
  vi.unstubAllEnvs()
})

const server = {
  name: 'local',
  transport: {
    type: 'stdio',
    command: process.execPath,
    args: [
      fileURLToPath(new URL('./testing/stdio-server.ts', import.meta.url)),
      'literal argument; $HOME',
    ],
  },
} satisfies McpServer
const info = async (familiar: Familiar) =>
  (await familiar.connections.list())[0] as McpConnectionInfo
const exited = (pid: number) => {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return true
    }
    throw error
  }
}

async function setup(factory: typeof stdioTransport | null = stdioTransport) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const children: ReturnType<typeof stdioTransport>[] = []
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    secrets: memorySecrets(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    mcpStdio: factory
      ? (config) => {
          const child = factory(config)
          children.push(child)
          return child
        }
      : undefined,
  })
  opened.add(familiar)
  return { familiar, faux, children }
}

test('owner-configured stdio tools run through Familiar with filtered environment and literal arguments', async () => {
  vi.stubEnv('FAMILIAR_TEST_SECRET', 'private-test-value')
  vi.stubEnv('FAMILIAR_DATA_DIR', '/private-test-data')
  vi.stubEnv('NODE_OPTIONS', '--expose-internals')
  const { familiar, faux, children } = await setup()
  const api = createHttpApi(familiar, { authenticate: () => 'owner' })
  const added = await api.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(server),
  })
  expect(added.status).toBe(201)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  expect((await info(familiar)).secrets).toEqual([])
  await expect(
    familiar.connections.setSecret(
      { kind: 'mcp', name: 'local' },
      'token',
      'not-for-stdio',
    ),
  ).rejects.toThrow('has no secret')
  let reply: ToolResultMessage | undefined
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      fauxToolCall('mcp__local__echo', { text: 'Hello from Familiar' }),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      reply = context.messages.findLast(
        (message) => message.role === 'toolResult',
      )
      return fauxAssistantMessage('Done.')
    },
  ])
  await familiar.send({
    author: 'owner',
    text: 'Echo.',
    requestId: 'stdio-echo',
  })
  await familiar.idle()
  expect(reply?.isError).toBe(false)
  const result = JSON.parse(
    reply?.content.find((block) => block.type === 'text')?.text ?? '',
  )
  expect(result).toMatchObject({
    text: 'Hello from Familiar',
    pid: children[0].pid,
    args: ['literal argument; $HOME'],
  })
  expect(result.environment).not.toContain('FAMILIAR_TEST_SECRET')
  expect(result.environment).not.toContain('FAMILIAR_DATA_DIR')
  expect(result.environment).not.toContain('NODE_OPTIONS')
  await familiar.mcp.remove('local')
  await expect.poll(() => exited(result.pid)).toBe(true)
  expect(await familiar.connections.list()).toEqual([])
})

test('process exit removes tools, reconnect launches a fresh process, and dismissal reaps it', async () => {
  const { familiar, faux, children } = await setup()
  await familiar.mcp.add(server)
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  const firstPid = children[0].pid!
  process.kill(firstPid, 'SIGTERM')
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('disconnected')
  expect((await info(familiar)).tools).toEqual([])
  let search: ToolResultMessage | undefined
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      search = context.messages.findLast(
        (message) => message.role === 'toolResult',
      )
      return fauxAssistantMessage('No tools.')
    },
  ])
  await familiar.send({
    author: 'owner',
    text: 'Find echo.',
    requestId: 'stdio-exited',
  })
  await familiar.idle()
  expect(search).toMatchObject({
    content: [
      { type: 'text', text: expect.stringContaining('No matching tools') },
    ],
  })
  await familiar.mcp.reconnect('local')
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('connected')
  const secondPid = children[1].pid!
  expect(secondPid).not.toBe(firstPid)
  await close(familiar)
  await expect.poll(() => exited(secondPid)).toBe(true)
})

test('hosts without stdio report an unsupported transport without blocking chat', async () => {
  const { familiar, faux } = await setup(null)
  await familiar.mcp.add(server)
  await expect
    .poll(async () => (await info(familiar)).status)
    .toEqual({ type: 'failed', error: 'This host has no MCP stdio transport.' })
  faux.setResponses([fauxAssistantMessage('Still here.')])
  await familiar.send({
    author: 'owner',
    text: 'Hello.',
    requestId: 'stdio-unsupported',
  })
  await familiar.idle()
})

test('removing a server during initialization closes the child process', async () => {
  const { familiar, children } = await setup()
  await familiar.mcp.add({
    ...server,
    transport: {
      ...server.transport,
      args: [server.transport.args[0], '--wait-for-close'],
    },
  })
  await expect.poll(() => children[0]?.pid).toBeTypeOf('number')
  const pid = children[0].pid!
  await familiar.mcp.remove('local')
  await expect.poll(() => exited(pid)).toBe(true)
  expect(await familiar.connections.list()).toEqual([])
})

test('an unavailable command reports failure and can be removed', async () => {
  const { familiar } = await setup()
  await familiar.mcp.add({
    name: 'local',
    transport: {
      type: 'stdio',
      command: '/nonexistent-familiar-mcp-command',
      args: [],
    },
  })
  await expect
    .poll(async () => (await info(familiar)).status.type)
    .toBe('failed')
  await familiar.mcp.remove('local')
  expect(await familiar.connections.list()).toEqual([])
})

test('a late process close preserves the initialization error', async () => {
  const events = new EventEmitter()
  const closed = once(events, 'closed')
  const { familiar } = await setup((config) => {
    const transport = stdioTransport(config)
    transport.onclose = () => {
      events.emit('closed')
    }
    return transport
  })
  await familiar.mcp.add({
    ...server,
    transport: {
      ...server.transport,
      args: [
        fileURLToPath(
          new URL('./testing/rejecting-stdio-server.ts', import.meta.url),
        ),
      ],
    },
  })
  await closed
  expect((await info(familiar)).status).toMatchObject({
    type: 'failed',
    error: expect.stringContaining('Initialization refused'),
  })
})
