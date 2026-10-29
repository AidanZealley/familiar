import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { textOf } from '../text.ts'
import type { Scenario } from '../types.ts'

// Pi compacts only when there is enough to summarise, so the compact scenario
// first fills the context with a demo-only tool.
export const fillContext = defineTool({
  name: 'fill_context',
  description: 'Demo only: pads the context so it can be compacted.',
  parameters: Type.Object({}),
  execute: async () => ({
    output: [
      { type: 'text', text: 'Padding for the compaction demo. '.repeat(1400) },
    ],
  }),
})

export const compact: Scenario = {
  start: () =>
    fauxAssistantMessage(
      [fauxToolCall('fill_context', {}), fauxToolCall('fill_context', {})],
      { stopReason: 'toolUse' },
    ),
  replies: {
    fill_context: (_output, context) =>
      context.messages.some((message) =>
        textOf(message.content).includes(
          'was compacted into the following summary',
        ),
      )
        ? fauxAssistantMessage(
            'Older messages were summarised to make room. They are still stored, but I now see the summary instead.',
          )
        : fauxAssistantMessage([], {
            // Pi recognises this error, compacts and retries.
            stopReason: 'error',
            errorMessage: 'Your input exceeds the context window of this model',
          }),
  },
}
