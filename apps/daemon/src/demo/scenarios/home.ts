import {
  Server,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/server'

// A pretend Home Assistant behind the demo's home-assistant connection,
// shaped like HA's real Assist API tools: actions name a device and its
// domain, and answer with success and failed lists but no new state; the
// state comes from GetLiveContext, a JSON envelope around a prose line
// and a YAML list of every device. The porch light never answers, so a
// card's failed call shows.

type Device = {
  name: string
  domain: 'light' | 'climate'
  area: string
  state: string
  /** As a percentage, as HassLightSet takes it. */
  brightness?: number
}

const devices: Device[] = [
  {
    name: 'Desk Lamp',
    domain: 'light',
    area: 'Living Room',
    state: 'on',
    brightness: 60,
  },
  { name: 'Porch Light', domain: 'light', area: 'Porch', state: 'off' },
  { name: 'Thermostat', domain: 'climate', area: 'Hall', state: 'heat' },
]

const OFFLINE = 'Porch Light'
const MODES = ['off', 'heat', 'cool', 'auto']

const target = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', description: 'The device, by name' },
    domain: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
}

// As Home Assistant's own tools would declare them: reads only read; the
// rest change one device, and saying it twice is the same as once.
const reads: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const sets: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export const homeTools: Tool[] = [
  {
    name: 'GetLiveContext',
    description:
      'Provides real-time information about the state of devices in the home.',
    inputSchema: { type: 'object' },
    annotations: reads,
  },
  {
    name: 'HassTurnOn',
    description: 'Turns on a device.',
    inputSchema: target,
    annotations: sets,
  },
  {
    name: 'HassTurnOff',
    description: 'Turns off a device.',
    inputSchema: target,
    annotations: sets,
  },
  {
    name: 'HassLightSet',
    description: 'Sets the brightness of a light.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        brightness: { type: 'integer', minimum: 0, maximum: 100 },
      },
      required: ['name', 'brightness'],
    },
    annotations: sets,
  },
  {
    name: 'HassClimateSetMode',
    description: 'Sets a thermostat to off, heat, cool or auto.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, mode: { enum: MODES } },
      required: ['name', 'mode'],
    },
    annotations: sets,
  },
]

/** The devices as they are now: what a scripted model has just read. */
export const homeState = () => structuredClone(devices)

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError && { isError }),
})

/** GetLiveContext's result text, as HA formats it. */
const liveContext = () =>
  [
    'Live Context: An overview of the areas and the devices in this smart home:',
    ...devices.flatMap((device) => [
      `- names: ${device.name}`,
      `  domain: ${device.domain}`,
      `  state: '${device.state}'`,
      `  areas: ${device.area}`,
      ...(device.brightness === undefined
        ? []
        : [
            '  attributes:',
            // HA reports 0-255; HassLightSet takes a percentage.
            `    brightness: '${Math.round((device.brightness * 255) / 100)}'`,
          ]),
    ]),
  ].join('\n')

/** Answers a call to one of `homeTools`, or undefined for another tool. */
export function callHome(
  tool: string,
  args: Record<string, unknown> = {},
): CallToolResult | undefined {
  if (!homeTools.some(({ name }) => name === tool)) {
    return undefined
  }
  if (tool === 'GetLiveContext') {
    return text({ success: true, result: liveContext() })
  }
  const device = devices.find((device) => device.name === args.name)
  if (!device) {
    return text(`MatchFailedError: no device named ${String(args.name)}`, true)
  }
  const entity = {
    name: device.name,
    type: 'entity',
    id: `${device.domain}.${device.name.toLowerCase().replace(/ /g, '_')}`,
  }
  if (device.name === OFFLINE) {
    return text({
      speech: {},
      response_type: 'action_done',
      data: { success: [], failed: [entity] },
    })
  }
  if (tool === 'HassTurnOn' || tool === 'HassTurnOff') {
    device.state = tool === 'HassTurnOn' ? 'on' : 'off'
  } else if (tool === 'HassLightSet') {
    device.brightness = Number(args.brightness)
    device.state = device.brightness > 0 ? 'on' : 'off'
  } else if (tool === 'HassClimateSetMode') {
    device.state = String(args.mode)
  }
  return text({
    speech: {},
    response_type: 'action_done',
    data: { success: [entity], failed: [] },
  })
}

/**
 * The pretend Home Assistant as an MCP server of its own: the demo serves it
 * at home.demo.invalid, and `home-server.ts` over HTTP for a dev daemon.
 */
export function homeServer() {
  const server = new Server(
    { name: 'pretend-home-assistant', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler('tools/list', () => ({ tools: homeTools }))
  server.setRequestHandler(
    'tools/call',
    ({ params }) =>
      callHome(params.name, params.arguments) ??
      text(`No tool ${params.name}.`, true),
  )
  return server
}
