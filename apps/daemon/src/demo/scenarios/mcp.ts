import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { Familiar, McpStdioFactory, PluginFetch } from '@familiar-ai/core'
import {
  InMemoryTransport,
  Server,
  WebStandardStreamableHTTPServerTransport,
  type Tool,
} from '@modelcontextprotocol/server'
import type { Scenario } from '../types.ts'

// Pretend MCP services, so the Connections page has real connections in every
// state without the demo reaching a network or starting a process.
const DEMO_TOKEN = 'demo-token'

const echo: Tool = {
  name: 'echo',
  description: 'Demo only: replies with the text it is given.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  annotations: { readOnlyHint: true },
}

const pretend = (names: string, readOnly: boolean): Tool[] =>
  names.split(' ').map((name) => ({
    name,
    description: `Demo only: pretends to ${name.replaceAll('_', ' ')}.`,
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: readOnly },
  }))

// Keyed by host. Any other host under demo.invalid, and any local command,
// serves echo, so a server added from the page can be tried in chat.
const services: Record<string, Tool[]> = {
  'home.demo.invalid': [
    ...pretend(
      'get_live_context list_areas list_devices get_history get_logbook get_weather',
      true,
    ),
    ...pretend(
      'turn_on turn_off toggle set_brightness set_colour set_temperature set_hvac_mode open_cover close_cover lock unlock media_pause media_play set_volume start_vacuum',
      false,
    ),
  ],
  'notes.demo.invalid': [
    ...pretend('search_notes read_note list_tags', true),
    ...pretend('create_note append_to_note', false),
  ],
  'printer.demo.invalid': [
    ...pretend('printer_status list_files', true),
    ...pretend(
      'start_print pause_print cancel_print set_bed_temperature',
      false,
    ),
  ],
  'mcp-server-time': pretend('get_current_time convert_time', true),
}

function serve(tools: Tool[]) {
  const server = new Server(
    { name: 'familiar-demo', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler('tools/list', () => ({ tools }))
  server.setRequestHandler('tools/call', ({ params }) => ({
    content: [
      {
        type: 'text',
        text:
          params.name === 'echo'
            ? String(params.arguments?.text ?? '')
            : `Demo only: ${params.name} did nothing.`,
      },
    ],
  }))
  return server
}

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

/** Any token but the demo's is rejected, so the page can show a refused one. */
export const demoMcpFetch: PluginFetch = async (input, init) => {
  const request = new Request(input, init)
  const { host, hostname } = new URL(request.url)
  if (!hostname.endsWith('.demo.invalid')) {
    throw new TypeError(`connect ECONNREFUSED ${host}`)
  }
  const auth = request.headers.get('authorization')
  if (auth && auth !== `Bearer ${DEMO_TOKEN}`) {
    return new Response(null, { status: 401 })
  }
  let transport = sessions.get(request.headers.get('mcp-session-id') ?? '')
  if (!transport) {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })
    await serve(services[hostname] ?? [echo]).connect(transport)
  }
  const response = await transport.handleRequest(request)
  if (transport.sessionId) {
    sessions.set(transport.sessionId, transport)
  }
  return response
}

export const demoMcpStdio: McpStdioFactory = ({ command, args }) => {
  const [client, server] = InMemoryTransport.createLinkedPair()
  const program = [command, ...args].join(' ')
  void serve(
    args.includes('mcp-server-time') ? services['mcp-server-time'] : [echo],
  ).connect(server)
  // Like a process that exits after a while, so Disconnected and Reconnect show.
  if (program.includes('flaky')) {
    setTimeout(() => void server.close(), 20_000)
  }
  return client
}

export async function seedMcp(familiar: Familiar) {
  const http = (name: string, url: string, bearer = false) =>
    familiar.mcp.add({
      name,
      transport: {
        type: 'http',
        url,
        auth: { type: bearer ? 'bearer' : 'none' },
      },
    })
  const stdio = (name: string, command: string, ...args: string[]) =>
    familiar.mcp.add({ name, transport: { type: 'stdio', command, args } })

  await http('home-assistant', 'http://home.demo.invalid:8123/api/mcp', true)
  await familiar.connections.setSecret(
    { kind: 'mcp', name: 'home-assistant' },
    'token',
    DEMO_TOKEN,
  )
  await http('notes', 'https://notes.demo.invalid/mcp')
  await http('printer', 'http://printer.demo.invalid/mcp', true)
  await http('nas', 'http://nas.local:8080/mcp')
  await stdio(
    'time',
    'uvx',
    'mcp-server-time',
    '--local-timezone=Europe/London',
  )
  await stdio('scratch', 'node', '/home/demo/flaky-server.js')
}

export const mcp: Scenario = {
  start: () =>
    fauxAssistantMessage(fauxToolCall('tool_search', { query: 'echo' }), {
      stopReason: 'toolUse',
    }),
  replies: {
    tool_search: (output) => {
      const name = output.match(/mcp__[a-z0-9-]+__echo/)?.[0]
      return name
        ? fauxAssistantMessage(
            fauxToolCall(name, { text: 'Hello from an MCP server.' }),
            { stopReason: 'toolUse' },
          )
        : fauxAssistantMessage(
            'No echo tool is connected. On the Connections page, add an HTTP server at http://echo.demo.invalid/mcp.',
          )
    },
  },
}
