import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { PluginContext, PluginFetch, PluginSecret } from '@familiar/core'
import { guardedFetch } from '../../fetch.ts'
import type { Scenario } from '../types.ts'

// A pretend service verifies that a key arrived without returning its value.
const DEMO_SERVICE = 'https://demo.invalid'

export const demoFetch: PluginFetch = async (input, init) =>
  new URL(input).origin === DEMO_SERVICE
    ? new Response(
        new Headers(init?.headers).has('X-Demo-Key')
          ? 'The demo key works.'
          : 'No demo key arrived.',
      )
    : guardedFetch(input, init)

export const checkDemoKey = (context: PluginContext) =>
  defineTool({
    name: 'check_demo_key',
    description: 'Demo only: checks the demo key from the Connections page.',
    parameters: Type.Object({}),
    execute: async () => {
      const response = await context.authorizedFetch(
        'key',
        `${DEMO_SERVICE}/check`,
      )
      return {
        output: [
          {
            type: 'text',
            text: await response.text(),
          },
        ],
      }
    },
  })

export const demoSecret: PluginSecret = {
  name: 'key',
  label: 'Demo key',
  help: 'Any non-empty visible ASCII text. Say "key" in chat to try it.',
  sendAs: {
    header: 'X-Demo-Key',
    origin: DEMO_SERVICE,
    requests: [{ method: 'GET', path: '/check' }],
  },
}

export const key: Scenario = {
  start: () =>
    fauxAssistantMessage(fauxToolCall('check_demo_key', {}), {
      stopReason: 'toolUse',
    }),
  replies: { check_demo_key: (output) => fauxAssistantMessage(output) },
}
