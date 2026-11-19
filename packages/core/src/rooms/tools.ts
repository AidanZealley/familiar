import * as schema from '@earendil-works/pi-schema'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { defineTool } from '../tools.ts'

/** The tool a Familiar ends a turn with when it has nothing to say. */
export const STAY_QUIET = 'stay_quiet'

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

/** stay_quiet: how a Familiar lets a room's conversation pass. */
export function roomTools(): ToolRegistration[] {
  const stayQuiet = defineTool({
    name: STAY_QUIET,
    description:
      "Say nothing this time, when you weren't addressed directly and have nothing distinct to add, or someone else is better placed to answer. Ends your turn.",
    parameters: schema.obj({
      reason: schema.opt(
        schema.str({ description: 'Why; nobody is shown it' }),
      ),
    }),
    replay: 'safe',
    // Ends the run without posting a room reply.
    execute: async () => ({
      ...text('You stayed quiet.'),
      control: { terminate: true },
    }),
  })

  return [stayQuiet]
}
