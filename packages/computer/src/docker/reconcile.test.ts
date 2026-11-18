import type { FamiliarId } from '@familiar-ai/core'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { dockerHost } from './index.ts'

// The Docker host's lifecycle without Docker: a fake engine in place of
// `dockerResources`, and agents in memory in place of `docker exec`.

const engine = vi.hoisted(() => {
  type Thing = { name: string; familiar?: FamiliarId; running?: boolean }
  const containers = new Map<string, Thing>()
  const volumes = new Map<string, Thing>()
  const state = {
    containers,
    volumes,
    /** Every lifecycle command, in order. */
    log: [] as string[],
    /** Holds the next command named this until released. */
    hold: undefined as
      { command: string; held: () => void; release: Promise<void> } | undefined,
    /** Throws from every command named this, until cleared. */
    fail: undefined as string | undefined,
    /** Whether each new connection reaches its agent. */
    reachable: [] as boolean[],
    /** How many connections have been made. */
    connections: 0,
  }
  let busy = false
  /** One lifecycle command: never while another runs. */
  const act = async (command: string, change: () => void) => {
    if (busy) {
      throw new Error(`${command} ran during another command`)
    }
    busy = true
    state.log.push(command)
    try {
      if (state.hold?.command === command) {
        const { held, release } = state.hold
        state.hold = undefined
        held()
        await release
      }
      await Promise.resolve()
      if (state.fail === command) {
        throw new Error(`${command} failed`)
      }
      change()
    } finally {
      busy = false
    }
  }
  const container = (familiar: FamiliarId) => `computer-${familiar}`
  const resources = {
    container,
    containers: async (familiar?: FamiliarId) =>
      [...containers.values()]
        .filter((c) => familiar === undefined || c.familiar === familiar)
        .map((c) => ({ ...c })),
    volumes: async () => [...volumes.values()].map((v) => ({ ...v })),
    remakeProxy: () =>
      act('proxy', () => {
        volumes.set('socket', { name: 'socket' })
        containers.set('proxy', { name: 'proxy', running: true })
      }),
    createComputer: (familiar: FamiliarId) =>
      act(`create ${familiar}`, () => {
        const disk = `${container(familiar)}-home`
        volumes.set(disk, { name: disk, familiar })
        containers.set(container(familiar), {
          name: container(familiar),
          familiar,
          running: false,
        })
      }),
    start: (familiar: FamiliarId) =>
      act(`start ${familiar}`, () => {
        containers.get(container(familiar))!.running = true
      }),
    stop: (familiar: FamiliarId) =>
      act(`stop ${familiar}`, () => {
        containers.get(container(familiar))!.running = false
      }),
    remove: (kind: 'container' | 'volume', name: string) =>
      act(`rm ${name}`, () => {
        ;(kind === 'container' ? containers : volumes).delete(name)
      }),
    outdated: async () => false,
    agentCommand: (familiar: FamiliarId) => [String(familiar)],
  }
  return { state, resources }
})

vi.mock('./resources.ts', async (actual) => ({
  ...(await actual<typeof import('./resources.ts')>()),
  dockerResources: () => engine.resources,
}))
vi.mock('./image.ts', () => ({
  computerImage: () => ({
    state: { state: 'ready' },
    ready: Promise.resolve(),
    removeOld: async () => {},
    close: () => {},
  }),
}))
vi.mock('@modelcontextprotocol/client/stdio', () => ({
  // A connection to an agent in memory, or one that fails as a stopped or
  // dead computer's `docker exec` would.
  StdioClientTransport: function ({ args }: { args: [string] }) {
    engine.state.connections++
    const { running } = engine.state.containers.get(`computer-${args[0]}`) ?? {}
    if (engine.state.reachable.shift() === false || !running) {
      return {
        start: async () => {
          throw new Error('the agent is gone')
        },
        send: async () => {},
        close: async () => {},
      }
    }
    const [agentSide, hostSide] = InMemoryTransport.createLinkedPair()
    const agent = new McpServer({ name: 'agent', version: '1.0.0' })
    agent.registerTool('ping', { inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    }))
    void agent.connect(agentSide)
    return hostSide
  },
}))

// Each test starts with an empty engine.
beforeEach(() => {
  Object.assign(engine.state, {
    log: [],
    hold: undefined,
    fail: undefined,
    reachable: [],
    connections: 0,
  })
  engine.state.containers.clear()
  engine.state.volumes.clear()
})

const ada = 1 as FamiliarId
const bo = 2 as FamiliarId

/** Holds the next `command` until `release` is called, once it starts. */
const holding = (command: string) => {
  let release!: () => void
  let held!: () => void
  const started = new Promise<void>((resolve) => (held = resolve))
  engine.state.hold = {
    command,
    held,
    release: new Promise((resolve) => (release = resolve)),
  }
  return { started, release }
}

test('the latest sync wins, and no two Docker changes ever run at once', async () => {
  const host = dockerHost()
  await host.sync([ada, bo])
  expect([...engine.state.containers.keys()].sort()).toEqual([
    'computer-1',
    'computer-2',
    'proxy',
  ])

  // An older sync's pass is removing Ada's computer when a newer one wants
  // Bo's alone, and a call wants Ada's.
  const removing = holding('rm computer-1')
  const older = host.sync([])
  await removing.started
  const newer = host.sync([bo])
  const call = host.call(ada, 'ping', {})
  removing.release()
  await older
  await newer

  expect([...engine.state.containers.keys()].sort()).toEqual([
    'computer-2',
    'proxy',
  ])
  expect([...engine.state.volumes.keys()].sort()).toEqual([
    'computer-2-home',
    'socket',
  ])
  expect(JSON.stringify(await call)).toMatch(/couldn't start.*turned off/)
})

test('before the first sync, a call waits and nothing is removed', async () => {
  // Ada's and Bo's computers and disks, left by the last process.
  for (const familiar of [ada, bo]) {
    const name = `computer-${familiar}`
    engine.state.containers.set(name, { name, familiar, running: false })
    engine.state.volumes.set(`${name}-home`, { name: `${name}-home`, familiar })
  }
  const host = dockerHost()

  // A call resumed after a restart, before the plugin has said who has one.
  const call = host.call(ada, 'ping', {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(engine.state.log).toEqual([])

  await host.sync([ada, bo])
  expect((await call).content).toContainEqual({ type: 'text', text: 'pong' })
  expect(engine.state.log).toEqual(['proxy', 'start 1'])
  expect([...engine.state.volumes.keys()].sort()).toEqual([
    'computer-1-home',
    'computer-2-home',
    'socket',
  ])
})

test('callers that meet a dead connection share one restart', async () => {
  const host = dockerHost()
  await host.sync([ada])
  // Running, but its agent can't be reached, once.
  engine.state.containers.get('computer-1')!.running = true
  engine.state.reachable = [false, true]
  engine.state.log = []

  const results = await Promise.all([
    host.call(ada, 'ping', {}),
    host.call(ada, 'ping', {}),
  ])
  for (const result of results) {
    expect(result.content).toContainEqual({ type: 'text', text: 'pong' })
  }
  expect(engine.state.log).toEqual(['stop 1', 'start 1'])
  // The dead connection and the restart's, shared by both callers.
  expect(engine.state.connections).toBe(2)
})

test('a call made while a pass runs is answered by the next pass', async () => {
  const host = dockerHost()
  await host.sync([ada, bo])

  // The pass waking Ada's computer has taken what calls were waiting for.
  const starting = holding('start 1')
  const first = host.call(ada, 'ping', {})
  await starting.started
  const second = host.call(bo, 'ping', {})
  starting.release()

  for (const result of await Promise.all([first, second])) {
    expect(result.content).toContainEqual({ type: 'text', text: 'pong' })
  }
  // Each connected first time: Bo's call didn't need its retry to run.
  expect(engine.state.connections).toBe(2)
})

test('a failing Docker command answers every waiting call, and later ones still run', async () => {
  const host = dockerHost()
  await host.sync([ada])
  engine.state.fail = 'start 1'

  const results = await Promise.all([
    host.call(ada, 'ping', {}),
    host.call(ada, 'ping', {}),
  ])
  for (const result of results) {
    expect(JSON.stringify(result)).toMatch(/couldn't start.*start 1 failed/)
  }

  engine.state.fail = undefined
  const later = await host.call(ada, 'ping', {})
  expect(later.content).toContainEqual({ type: 'text', text: 'pong' })
})

test('once closed, a host wakes and connects to nothing, even for a call already under way', async () => {
  const host = dockerHost()
  await host.sync([ada])
  engine.state.log = []

  // A call is waiting on the pass starting Ada's computer when the host
  // closes. Its connection then fails, so it would try a restart.
  engine.state.reachable = [false]
  const starting = holding('start 1')
  const call = host.call(ada, 'ping', {})
  await starting.started
  const closed = host.close()
  starting.release()
  await closed

  expect(JSON.stringify(await call)).toMatch(/couldn't start.*closed/)
  expect(engine.state.log).toEqual(['start 1'])
  expect(engine.state.connections).toBe(1)
})
