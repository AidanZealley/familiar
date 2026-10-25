import { Type } from '@earendil-works/pi-ai'
import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable'

// Kept stable: a prompt section that changes resends the prompt and loses the
// provider's prompt cache. Anything that varies, like the time, is a tool.
const preamble = (name: string) =>
  `You are ${name}, a personal assistant. You live in one long-running conversation with the people you help, so earlier messages may be days old. Be warm, brief and direct. Each person's messages are their own words; reply to the latest one.`

const currentTime = defineTool({
  name: 'current_time',
  description:
    "The current date and time, in the host's time zone unless one is given.",
  parameters: Type.Object({
    timeZone: Type.Optional(
      Type.String({ description: 'IANA time zone, e.g. Europe/London' }),
    ),
  }),
  replay: 'safe',
  execute: async ({ timeZone }) => ({
    output: [
      {
        type: 'text',
        text: new Date().toLocaleString('en-GB', {
          timeZone,
          dateStyle: 'full',
          timeStyle: 'long',
        }),
      },
    ],
  }),
})

export const createPersona = (name: string) =>
  defineExtension({
    name: 'familiar.persona',
    sections: [section('preamble', () => preamble(name), { tag: false })],
    tools: [currentTime],
  })
