import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { homeState } from './home.ts'
import type { Scenario } from './scenario.ts'

// A card of controls over the pretend Home Assistant, as a model would
// write it having just read GetLiveContext: switches bind turnOn and
// turnOff, the slider and select call tools that take the value, a button
// confirms first, and a refresh reads the house again by each device's name.

const tool = (name: string) => `mcp__home-assistant__${name}`

const onOff = (name: string) => {
  const call = (action: string) => ({
    action: 'callTool',
    params: { tool: tool(action), args: { name, domain: ['light'] } },
  })
  return { turnOn: call('HassTurnOn'), turnOff: call('HassTurnOff') }
}

/** A regex for one device's field in GetLiveContext's YAML. */
const field = (name: string, key: string) =>
  `names: ${name}\\n(?:  .*\\n)*?  ${key}: '([^']*)'`

const controlsCard = () => {
  const [desk, porch, thermostat] = homeState()
  return {
    root: 'controls',
    state: {
      desk: { on: desk!.state === 'on', brightness: desk!.brightness ?? 0 },
      porch: { on: porch!.state === 'on' },
      heating: { mode: thermostat!.state },
    },
    elements: {
      controls: {
        type: 'Card',
        props: { title: 'Living room', description: 'Lights and heating' },
        children: ['desk', 'brightness', 'porch', 'divider', 'mode', 'off'],
      },
      desk: {
        type: 'Switch',
        props: { label: 'Desk lamp', checked: { $bindState: '/desk/on' } },
        on: onOff('Desk Lamp'),
        children: [],
      },
      brightness: {
        type: 'Slider',
        props: {
          label: 'Brightness',
          value: { $bindState: '/desk/brightness' },
          min: 0,
          max: 100,
          step: 5,
          unit: '%',
        },
        on: {
          change: {
            action: 'callTool',
            params: {
              tool: tool('HassLightSet'),
              args: {
                name: 'Desk Lamp',
                brightness: { $state: '/desk/brightness' },
              },
            },
          },
        },
        children: [],
      },
      porch: {
        type: 'Switch',
        props: {
          label: 'Porch light',
          description: 'Often offline',
          checked: { $bindState: '/porch/on' },
        },
        on: onOff('Porch Light'),
        children: [],
      },
      divider: { type: 'Separator', props: {}, children: [] },
      mode: {
        type: 'Select',
        props: {
          label: 'Heating',
          options: ['off', 'heat', 'cool', 'auto'].map((value) => ({
            label: value.charAt(0).toUpperCase() + value.slice(1),
            value,
          })),
          value: { $bindState: '/heating/mode' },
        },
        on: {
          change: {
            action: 'callTool',
            params: {
              tool: tool('HassClimateSetMode'),
              args: { name: 'Thermostat', mode: { $state: '/heating/mode' } },
            },
          },
        },
        children: [],
      },
      off: {
        type: 'Button',
        props: { label: 'Lamp off for the night', variant: 'outline' },
        on: {
          press: {
            action: 'callTool',
            params: {
              tool: tool('HassTurnOff'),
              args: { name: 'Desk Lamp', domain: ['light'] },
            },
            confirm: {
              title: 'Turn the desk lamp off?',
              message: 'It is at ${/desk/brightness}%.',
              confirmLabel: 'Turn off',
            },
            onSuccess: { set: { '/desk/on': false } },
          },
        },
        children: [],
      },
    },
    refresh: {
      tool: tool('GetLiveContext'),
      from: '/result',
      extract: {
        '/desk/on': {
          match: field('Desk Lamp', 'state'),
          map: { on: true, off: false },
        },
        '/desk/brightness': {
          match: field('Desk Lamp', '  brightness'),
          as: 'number',
        },
        '/porch/on': {
          match: field('Porch Light', 'state'),
          map: { on: true, off: false },
        },
        '/heating/mode': { match: field('Thermostat', 'state') },
      },
    },
  }
}

/**
 * Controls for the pretend Home Assistant, for a Familiar that uses it:
 * say "controls" to Juniper.
 */
export const controls: Scenario = {
  start: () =>
    fauxAssistantMessage(fauxToolCall('show_card', controlsCard()), {
      stopReason: 'toolUse',
    }),
  replies: {
    show_card: (output) =>
      fauxAssistantMessage(
        output.startsWith('The card is shown')
          ? "Here are the living room's controls. Changing the heating asks you first."
          : `I couldn't show the controls:\n\n${output}`,
      ),
  },
}
