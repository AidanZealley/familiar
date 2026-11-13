import { fileURLToPath } from 'node:url'
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  type Workspace,
  type McpConnectionInfo,
  type McpServer,
} from '@familiar-ai/core'
import { createModels, type ToolResultMessage } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
import { stdioTransport } from './mcp-stdio.ts'
import { openDaemonWorkspace } from './workspace.ts'
import { replyTo } from './reply.ts'

// Owner-configured commands run as the daemon's user, through the daemon's
// stdio transport. Core owns the connection; these check what the child
// process sees and that none outlives the server that started it.

afterEach(() => {
  vi.unstubAllEnvs()
})

const server = {
  name: 'local',
  transport: {
    type: 'stdio',
    command: process.execPath,
    args: [
      fileURLToPath(new URL('./mcp-stdio-server.ts', import.meta.url)),
      'literal argument; $HOME',
    ],
  },
} satisfies McpServer

const status = async (familiar: Workspace) =>
  ((await familiar.connections.list())[0] as McpConnectionInfo).status.type

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

/** A Familiar whose stdio servers start through the daemon's transport. */
async function setup() {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const children: ReturnType<typeof stdioTransport>[] = []
  const { workspace, familiar: id } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      mcpStdio: (config) => {
        const child = stdioTransport(config)
        children.push(child)
        return child
      },
    },
    'Familiar',
  )
  onTestFinished(() => workspace.dismiss())
  const dm = (await workspace.rooms.get(await workspace.rooms.dm(id, 'owner')))!
  return { familiar: workspace, id, dm, faux, children }
}

test("a command gets literal arguments and none of the daemon's private environment, and no process outlives it", async () => {
  vi.stubEnv('FAMILIAR_TEST_SECRET', 'private-test-value')
  vi.stubEnv('FAMILIAR_DATA_DIR', '/private-test-data')
  vi.stubEnv('NODE_OPTIONS', '--expose-internals')
  const { familiar, id, dm, faux, children } = await setup()
  await familiar.mcp.add(server)
  // Each Familiar opts in to the connections it uses.
  await familiar.familiars.get(id)!.setCapabilities({ mcp: [server.name] })
  await expect.poll(() => status(familiar)).toBe('connected')

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
  await replyTo(
    dm,
    await dm.post({
      author: { id: 'owner', name: 'owner' },
      text: 'Echo.',
      requestId: 'stdio-echo',
    }),
  )
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

  // A process that exits takes its tools; reconnecting starts a new one.
  process.kill(result.pid, 'SIGTERM')
  await expect.poll(() => status(familiar)).toBe('disconnected')
  expect(
    ((await familiar.connections.list())[0] as McpConnectionInfo).tools,
  ).toEqual([])
  await familiar.mcp.reconnect('local')
  await expect.poll(() => status(familiar)).toBe('connected')
  const second = children[1].pid!
  expect(second).not.toBe(result.pid)

  // Dismissal reaps it.
  await familiar.dismiss()
  await expect.poll(() => exited(second)).toBe(true)
})

test('removing a server during startup closes its process', async () => {
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
