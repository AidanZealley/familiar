import type { Context } from '@earendil-works/chord/context'
import type { ConnectionTool } from '@familiar-ai/core'
import { expect, test } from 'vitest'
import { cardsPlugin } from './plugin.ts'

const showCard = cardsPlugin.tools![0]!

const tools: ConnectionTool[] = [
  {
    name: 'mcp__home__GetLiveContext',
    parameters: { type: 'object', properties: {} },
    askBeforeRunning: false,
  },
  {
    name: 'mcp__home__HassTurnOn',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    askBeforeRunning: false,
  },
]

// What core's familiar(context) finds: only the services show_card uses.
const context = {
  value: (key: { token: symbol }) =>
    key.token === Symbol.for('familiar.toolServices')
      ? { connectionTools: async () => tools }
      : undefined,
} as unknown as Context

// The refresh read, as HA words it: the kitchen light is off.
const api = {
  executeTool: async () => ({
    isError: false,
    diagnostics: [],
    structuredOutput: [
      { type: 'text', text: "- names: Kitchen\n  state: 'off'\n" },
    ],
  }),
} as never

const card = (tool: string, on: boolean) => ({
  root: 'kitchen',
  state: { on },
  elements: {
    kitchen: {
      type: 'Switch',
      props: { label: 'Kitchen', checked: { $bindState: '/on' } },
      on: {
        turnOn: {
          action: 'callTool',
          params: { tool, args: { name: 'Kitchen' } },
        },
      },
      children: [],
    },
  },
  refresh: {
    tool: 'mcp__home__GetLiveContext',
    extract: {
      '/on': {
        match: "names: Kitchen\\n  state: '(on|off)'",
        map: { on: true, off: false },
      },
    },
  },
})

const show = async (spec: object) => {
  const result = await showCard.execute(spec as never, api, context)
  const [first] = result.output as { text: string }[]
  return { isError: Boolean(result.isError), text: first!.text }
}

test("show_card refuses unknown tools and a refresh that doesn't match, then shows the card", async () => {
  const unknown = await show(card('mcp__home__Teleport', false))
  expect(unknown.isError).toBe(true)
  expect(unknown.text).toContain(
    "runs mcp__home__Teleport, which isn't one of your MCP connection tools",
  )

  // The card says on; the house says off.
  const stale = await show(card('mcp__home__HassTurnOn', true))
  expect(stale.isError).toBe(true)
  expect(stale.text).toContain('your state says true')
  expect(stale.text).toContain('How to write refresh')

  expect(await show(card('mcp__home__HassTurnOn', false))).toEqual({
    isError: false,
    text: 'The card is shown.',
  })
})
