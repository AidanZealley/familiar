import { InMemoryTransport, Server } from '@modelcontextprotocol/server'
import { expect, test } from 'vitest'
import type { ToolRunData } from '../rooms/log.ts'
import { testHost } from '../testing.ts'

/**
 * A Home Assistant-like MCP server: actions take a device's name and answer
 * with success and failed lists, as HA's Assist tools do; a read-only
 * GetLiveContext returns the house.
 */
function home() {
  const calls: string[] = []
  const server = new Server(
    { name: 'home', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  const target = {
    type: 'object' as const,
    properties: { name: { type: 'string' } },
    required: ['name'],
  }
  server.setRequestHandler('tools/list', () => ({
    tools: [
      { name: 'HassTurnOff', inputSchema: target },
      { name: 'HassUnlock', inputSchema: target },
      {
        name: 'GetLiveContext',
        inputSchema: { type: 'object' as const },
        annotations: { readOnlyHint: true },
      },
      // Reads too, but doesn't say so: never run without a click.
      { name: 'GetHistory', inputSchema: { type: 'object' as const } },
    ],
  }))
  server.setRequestHandler('tools/call', ({ params }) => {
    const name = String(params.arguments?.name ?? '')
    calls.push(`${params.name} ${name}`.trim())
    if (params.name === 'GetLiveContext') {
      return {
        content: [{ type: 'text', text: "- names: Lamp\n  state: 'on'" }],
      }
    }
    const device = { name, type: 'entity' }
    const broken = name === 'Porch'
    const data = {
      success: broken ? [] : [device],
      failed: broken ? [device] : [],
    }
    return { content: [{ type: 'text', text: JSON.stringify({ data }) }] }
  })
  const transport = () => {
    const [client, end] = InMemoryTransport.createLinkedPair()
    void server.connect(end)
    return client
  }
  return { calls, transport }
}

test("a person runs a Familiar's tools once each, asks first where the owner says, and only reads read-only tools", async () => {
  const { calls, transport } = home()
  const host = await testHost({ mcpStdio: transport })
  const workspace = host.workspace()
  await workspace.mcp.add({
    name: 'home',
    transport: { type: 'stdio', command: 'home', args: [] },
  })
  await expect
    .poll(async () => {
      const [connection] = await workspace.connections.list()
      return connection?.kind === 'mcp' && connection.status.type
    })
    .toBe('connected')
  await host.familiar().setCapabilities({ mcp: ['home'] })
  await workspace.connections.updateToolSettings(
    { kind: 'mcp', name: 'home' },
    'HassUnlock',
    { askBeforeRunning: true },
  )

  const familiar = host.familiar().id
  const room = host.dm().id
  const run = (tool: string, name: string, approved?: boolean) =>
    workspace.tools.run({
      familiar,
      room,
      author: { id: 'aidan', name: 'Aidan' },
      tool: `mcp__home__${tool}`,
      args: { name },
      ...(approved && { approved }),
      requestId: crypto.randomUUID(),
    })
  const read = (tool: string) =>
    workspace.tools.read({
      familiar,
      room,
      tool: `mcp__home__${tool}`,
      args: {},
    })

  expect(await run('HassTurnOff', 'Lamp')).toEqual({ outcome: 'done' })
  expect(await run('HassTurnOff', 'Porch')).toMatchObject({ outcome: 'failed' })
  expect(await run('HassUnlock', 'Door')).toEqual({ outcome: 'ask' })
  expect(await run('HassUnlock', 'Door', true)).toEqual({ outcome: 'done' })
  expect(await run('HassGone', 'Lamp')).toEqual({ outcome: 'unavailable' })
  expect(await read('GetLiveContext')).toEqual({
    outcome: 'read',
    text: "- names: Lamp\n  state: 'on'",
  })
  expect(await read('GetHistory')).toEqual({ outcome: 'unavailable' })
  expect(calls).toEqual([
    'HassTurnOff Lamp',
    'HassTurnOff Porch',
    'HassUnlock Door',
    'GetLiveContext',
  ])

  // Runs are recorded in the room; reads aren't.
  const page = await host.dm().history({ order: 'ascending' }, 50)
  const recorded = page.items
    .filter((entry) => entry.kind === 'familiar.tool-run')
    .map((entry) => {
      const data = entry.data as unknown as ToolRunData
      return `${data.tool} ${data.outcome}`
    })
  expect(recorded).toEqual([
    'mcp__home__HassTurnOff done',
    'mcp__home__HassTurnOff failed',
    'mcp__home__HassUnlock done',
  ])
  // What plugins see: each tool with its annotations and ask setting.
  expect(
    (await workspace.tools.list(familiar)).map(
      ({ name, askBeforeRunning, annotations }) =>
        `${name} ${askBeforeRunning} ${annotations?.readOnlyHint ?? '-'}`,
    ),
  ).toEqual([
    'mcp__home__HassTurnOff false -',
    'mcp__home__HassUnlock true -',
    'mcp__home__GetLiveContext false true',
    'mcp__home__GetHistory false -',
  ])
})
