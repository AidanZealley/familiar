import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { McpStdioFactory, PluginFetch, Workspace } from '@familiar-ai/core'
import {
  InMemoryTransport,
  Server,
  WebStandardStreamableHTTPServerTransport,
  type Tool,
} from '@modelcontextprotocol/server'
import type { Scenario } from './scenario.ts'

// Pretend MCP services, so the Connections page has real connections in every
// state without the demo reaching a network or starting a process.
const DEMO_TOKEN = 'demo-token'

const echo: Tool = {
  name: 'echo',
  description: 'Replies with the text it is given.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  annotations: { readOnlyHint: true },
}

/** Tools that answer without doing anything, described as the real ones would be. */
const pretend = (readOnly: boolean, tools: Record<string, string>): Tool[] =>
  Object.entries(tools).map(([name, description]) => ({
    name,
    description,
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: readOnly },
  }))

// Keyed by host. Any other host under demo.invalid, and any local command,
// serves echo, so a server added from the page can be tried in chat.
const services: Record<string, Tool[]> = {
  'home.demo.invalid': [
    ...pretend(true, {
      get_live_context: 'Gets the current state of every exposed device.',
      list_areas: 'Lists the areas of the home.',
      list_devices: 'Lists devices, optionally in one area.',
      get_history: 'Gets how a device’s state changed over a period.',
      get_logbook: 'Gets recent events, such as doors opening.',
      get_weather: 'Gets the forecast for the home’s location.',
    }),
    ...pretend(false, {
      turn_on: 'Turns a device or area on.',
      turn_off: 'Turns a device or area off.',
      toggle: 'Switches a device between on and off.',
      set_brightness: 'Sets a light’s brightness.',
      set_colour: 'Sets a light’s colour.',
      set_temperature: 'Sets a thermostat’s target temperature.',
      set_hvac_mode: 'Sets heating or cooling to off, heat, cool or auto.',
      open_cover: 'Opens a blind, curtain or garage door.',
      close_cover: 'Closes a blind, curtain or garage door.',
      lock: 'Locks a lock.',
      unlock: 'Unlocks a lock.',
      media_pause: 'Pauses a media player.',
      media_play: 'Resumes a media player.',
      set_volume: 'Sets a media player’s volume.',
      start_vacuum: 'Sends the robot vacuum to clean.',
    }),
  ],
  'notes.demo.invalid': [
    ...pretend(true, {
      search_notes: 'Searches your notes by keyword.',
      read_note: 'Reads a note in full.',
      list_tags: 'Lists the tags your notes use.',
    }),
    ...pretend(false, {
      create_note: 'Creates a note with a title and text.',
      append_to_note: 'Adds text to the end of a note.',
    }),
  ],
  'printer.demo.invalid': [
    ...pretend(true, {
      printer_status: 'Gets the printer’s state, temperatures and progress.',
      list_files: 'Lists the files ready to print.',
    }),
    ...pretend(false, {
      start_print: 'Starts printing a file.',
      pause_print: 'Pauses the current print.',
      cancel_print: 'Cancels the current print.',
      set_bed_temperature: 'Sets the print bed’s temperature.',
    }),
  ],
  'mcp-server-time': pretend(true, {
    get_current_time: 'Gets the current time in a time zone.',
    convert_time: 'Converts a time between time zones.',
  }),
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
            : 'Done.',
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

export async function seedMcp(workspace: Workspace) {
  const http = (name: string, url: string, bearer = false) =>
    workspace.mcp.add({
      name,
      transport: {
        type: 'http',
        url,
        auth: { type: bearer ? 'bearer' : 'none' },
      },
    })
  const stdio = (name: string, command: string, ...args: string[]) =>
    workspace.mcp.add({ name, transport: { type: 'stdio', command, args } })

  await http('home-assistant', 'http://home.demo.invalid:8123/api/mcp', true)
  await workspace.connections.setSecret(
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
