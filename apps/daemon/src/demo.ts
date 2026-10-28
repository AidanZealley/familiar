// A Familiar for UI work: a scripted model, fresh in-memory storage on every
// start, seeded with sample memory, and no credentials, so it runs beside the
// real service without touching its data directory. Usage: pnpm dev:demo
//
// Deliberately imports nothing from config.ts, which creates the real data
// directory on import.

import {
  Type,
  type AssistantMessage,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import {
  defineExtension,
  defineTool,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import {
  definePlugin,
  memorySecrets,
  summonFamiliar,
  type PluginContext,
  type PluginFetch,
} from '@familiar/core'
import {
  SEED_MESSAGE,
  seedEpisodes,
  seedMemory,
  seedPinned,
} from './demo/seed.ts'
import { guardedFetch } from './fetch.ts'
import { openPush } from './push.ts'
import { serveFamiliar } from './serve.ts'

const markdownReply = `## A quick tour

This reply shows what **Markdown** looks like, with \`inline code\` and a [link](https://example.com).

### Lists

- Groceries for the week
- A call with the plumber at 3pm
  - bring the boiler manual
- Water the plants

1. Preheat the oven
2. Mix the dry ingredients
3. Bake for 25 minutes

### A table

| Day       | Plan          | Time  |
| --------- | ------------- | ----- |
| Monday    | Climbing      | 18:00 |
| Wednesday | Dinner out    | 19:30 |
| Saturday  | Farmers market | 09:00 |

### Some code

\`\`\`ts
export function greet(name: string) {
  return \`Hello, \${name}!\`
}
\`\`\`

> Say **tool**, **memory**, **remind**, **key**, **slow**, **compact** or **error** to see the other scenarios.`

const slowReply = Array.from(
  { length: 30 },
  (_, i) =>
    `**Part ${i + 1}.** This is a long reply for testing Stop and queued messages. Send another message while it streams and it waits its turn; press Stop to end this one early. The text keeps going so there is plenty of time to try both.`,
).join('\n\n')

const pad = (value: number) => String(value).padStart(2, '0')

/** The next whole minute, as the schedule tool's local `YYYY-MM-DD HH:MM`. */
function nextMinute() {
  const at = new Date(Date.now() + 60_000)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** What the model does for a message, picked by a word in it. */
const scenarios: Record<string, () => AssistantMessage> = {
  tool: () =>
    fauxAssistantMessage(
      [
        fauxThinking('They want the time, so I should check the clock.'),
        fauxToolCall('current_time', { timeZone: 'Europe/London' }),
      ],
      { stopReason: 'toolUse' },
    ),
  memory: () =>
    fauxAssistantMessage(fauxToolCall('recall', { query: 'morning drink' }), {
      stopReason: 'toolUse',
    }),
  remind: () =>
    fauxAssistantMessage(
      fauxToolCall('schedule', {
        prompt: 'Remind the owner to stand up and stretch',
        at: nextMinute(),
      }),
      { stopReason: 'toolUse' },
    ),
  key: () =>
    fauxAssistantMessage(fauxToolCall('check_demo_key', {}), {
      stopReason: 'toolUse',
    }),
  slow: () => fauxAssistantMessage(slowReply),
  compact: () =>
    // Tool output is truncated to about 12k tokens, and Pi keeps the newest 20k.
    fauxAssistantMessage(
      [fauxToolCall('fill_context', {}), fauxToolCall('fill_context', {})],
      { stopReason: 'toolUse' },
    ),
  error: () =>
    fauxAssistantMessage(fauxText('Let me look that up for'), {
      stopReason: 'error',
      // Not one of pi-ai's retryable errors, so it fails at once.
      errorMessage: 'The demo model failed on purpose.',
    }),
}

/** After a tool runs, a reply that uses its result. */
function afterTool(toolName: string, output: string, compacted: boolean) {
  if (toolName === 'fill_context') {
    return compacted
      ? fauxAssistantMessage(
          'Older messages were summarised to make room. They are still stored, but I now see the summary instead.',
        )
      : // One of the errors pi-ai recognises as a context overflow, which
        // makes Pi compact and retry.
        fauxAssistantMessage([], {
          stopReason: 'error',
          errorMessage: 'Your input exceeds the context window of this model',
        })
  }
  if (toolName.startsWith('seed_')) {
    return fauxAssistantMessage(
      'Saved. The **Memory** pages show it all: facts, how they changed and a year of episodes.',
    )
  }
  if (toolName === 'check_demo_key') {
    return fauxAssistantMessage(output)
  }
  if (toolName === 'schedule') {
    return fauxAssistantMessage(`I'll remind you within a minute. ${output}`)
  }
  return fauxAssistantMessage(
    toolName === 'recall'
      ? `Here's what I found:\n\n${output}`
      : `It's **${output}**.`,
  )
}

function reply(context: TranscriptContext) {
  if (isSummaryRequest(context)) {
    return fauxAssistantMessage('The person tried the demo scenarios.')
  }
  // A changed memory section adds a system message after a tool result, and
  // recall adds a note after the latest message; neither is the person.
  const messages = context.messages.filter(
    (message) => message.role !== 'system' && !isRecallNote(message),
  )
  const last = messages.at(-1)
  if (last?.role === 'toolResult') {
    return afterTool(
      last.toolName,
      textOf(last.content),
      context.messages.some((message) =>
        textOf(message.content).includes(
          'was compacted into the following summary',
        ),
      ),
    )
  }
  const latest = textOf(
    messages.findLast((message) => message.role === 'user')?.content,
  )
  // Checked before the words: a scheduled prompt may contain one.
  if (latest.startsWith('[Scheduled')) {
    return fauxAssistantMessage(
      "**Time to stretch!** You've been sitting a while: stand up, roll your shoulders and look at something far away for a minute.",
    )
  }
  if (latest === SEED_MESSAGE) {
    return fauxAssistantMessage(
      [fauxToolCall('seed_memory', {}), fauxToolCall('seed_episodes', {})],
      { stopReason: 'toolUse' },
    )
  }
  const text = latest.toLowerCase()
  const word = Object.keys(scenarios).find((word) =>
    new RegExp(`\\b${word}\\b`).test(text),
  )
  return word ? scenarios[word]() : fauxAssistantMessage(markdownReply)
}

// Pi's compaction asks the same model for the summary.
const isSummaryRequest = (context: TranscriptContext) =>
  context.messages.some(
    (message) =>
      message.role === 'system' &&
      textOf(message.content).includes('context summarization assistant'),
  )

const isRecallNote = (message: TranscriptContext['messages'][number]) =>
  message.role === 'user' &&
  textOf(message.content).startsWith('Recalled from memory')

const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')

// Readable, but fast enough that a whole reply doesn't drag.
const faux = fauxProvider({ tokensPerSecond: 40 })
// The provider answers from a queue, one step per request. This step reads
// the request and queues itself again, so the script never runs out.
const respond: FauxResponseFactory = (context) => {
  faux.appendResponses([respond])
  return reply(context)
}
faux.setResponses([respond])

const models = createModels()
models.setProvider(faux.provider)

// Pi compacts only when there is enough to summarise, so the compact scenario
// first fills the context with a demo-only tool.
const fillContext = defineTool({
  name: 'fill_context',
  description: 'Demo only: pads the context so it can be compacted.',
  parameters: Type.Object({}),
  execute: async () => ({
    output: [
      { type: 'text', text: 'Padding for the compaction demo. '.repeat(1400) },
    ],
  }),
})

// A pretend service, answered here rather than over the network, that
// echoes the key it was sent: the reply shows the key arrived, and that
// redaction keeps it out of the chat.
const DEMO_SERVICE = 'https://demo.invalid'

const demoFetch: PluginFetch = async (input, init) =>
  new URL(input).origin === DEMO_SERVICE
    ? new Response(new Headers(init?.headers).get('X-Demo-Key') ?? '')
    : guardedFetch(input, init)

const checkDemoKey = (context: PluginContext) =>
  defineTool({
    name: 'check_demo_key',
    description: 'Demo only: checks the demo key from the Connections page.',
    parameters: Type.Object({}),
    execute: async () => {
      const response = await context.authorizedFetch(
        'key',
        `${DEMO_SERVICE}/echo`,
      )
      return {
        output: [
          {
            type: 'text',
            text: `The demo key works. The service echoed it as ${await response.text()}.`,
          },
        ],
      }
    },
  })

const demoPlugin = definePlugin({
  name: 'demo',
  title: 'Demo',
  secrets: [
    {
      name: 'key',
      label: 'Demo key',
      help: 'Any text of eight or more characters. Say "key" in chat to try it.',
      sendAs: {
        header: 'X-Demo-Key',
        origin: DEMO_SERVICE,
        requests: [{ method: 'GET', path: '/echo' }],
      },
    },
  ],
  extension: (context) =>
    defineExtension({
      name: 'demo',
      tools: [fillContext, seedMemory, seedEpisodes, checkDemoKey(context)],
    }),
})

// Keys and subscriptions last as long as the demo, so a browser subscribes
// again after a restart. Every notification is logged too.
const push = openPush({ contact: 'mailto:familiar@example.com' })

const familiar = await summonFamiliar({
  storage: new MemoryStorage(),
  models,
  model: { provider: 'faux', modelId: 'faux-1' },
  notify: async (notification) => {
    console.log('Notification:', JSON.stringify(notification))
    await push.notify(notification)
  },
  plugins: [demoPlugin],
  secrets: memorySecrets(),
  fetch: demoFetch,
})

// Start with a year of sample memory, so the Memory pages have something to
// show. Pinning goes through the owner's API, which rebalances core.
await familiar.send({ author: 'demo', text: SEED_MESSAGE, requestId: 'seed' })
await familiar.idle()
const watch = await familiar.memory.watch()
await watch.stop()
for (const text of seedPinned) {
  const fact = watch.value?.facts.find((fact) => fact.text === text)
  if (fact) {
    await familiar.memory.setPinned(fact.id, true)
  }
}

serveFamiliar(familiar, {
  host: '127.0.0.1',
  port: Number(process.env.FAMILIAR_DEMO_PORT ?? 4318),
  owner: 'demo',
  label: 'Familiar demo',
  push: push.host,
})
