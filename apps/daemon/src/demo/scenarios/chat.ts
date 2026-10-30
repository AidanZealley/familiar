import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
  fauxText,
} from '@earendil-works/pi-ai/providers/faux'
import type { Scenario } from '../types.ts'

export const markdownReply = `## A quick tour

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

### Maths

The area of a circle is $$\\pi r^2$$, and the roots of a quadratic are

$$
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$

### A diagram

\`\`\`mermaid
flowchart LR
  Message --> Recall --> Reply
  Reply --> Memory[(Memory)]
\`\`\`

### An image

![Familiar's icon](/icon-192.png)

> Say **tool**, **memory**, **remind**, **key**, **slow**, **compact** or **error** to see the other scenarios.`

const slowReply = Array.from(
  { length: 30 },
  (_, i) =>
    `**Part ${i + 1}.** This is a long reply for testing Stop and queued messages. Send another message while it streams and it waits its turn; press Stop to end this one early. The text keeps going so there is plenty of time to try both.`,
).join('\n\n')

export const tool: Scenario = {
  start: () =>
    fauxAssistantMessage(
      [
        fauxThinking('They want the time, so I should check the clock.'),
        fauxToolCall('current_time', { timeZone: 'Europe/London' }),
      ],
      { stopReason: 'toolUse' },
    ),
  replies: {
    current_time: (output) => fauxAssistantMessage(`It's **${output}**.`),
  },
}
export const slow: Scenario = { start: () => fauxAssistantMessage(slowReply) }
export const error: Scenario = {
  start: () =>
    fauxAssistantMessage(fauxText('Let me look that up for'), {
      stopReason: 'error',
      // Not one of pi-ai's retryable errors, so it fails at once.
      errorMessage: 'The demo model failed on purpose.',
    }),
}
