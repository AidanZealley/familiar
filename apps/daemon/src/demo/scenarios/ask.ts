import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { TranscriptContext } from '@familiar-ai/core/models'
import { mcp } from './mcp.ts'
import type { Scenario } from './scenario.ts'

// Each kind of question for the person: Familiar asking before Home
// Assistant unlocks a door, then the bench server asking yes or no before
// a print, as Topsail does, and asking for a spool's details in a form.

const call = (name: string, args: Record<string, string> = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/** The query of the run's latest tool search, which says which step this is. */
const lastQuery = (context: TranscriptContext) => {
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'assistant') {
      continue
    }
    const search = message.content.find(
      (part) => part.type === 'toolCall' && part.name === 'tool_search',
    )
    if (search?.type === 'toolCall') {
      return String(search.arguments.query)
    }
  }
  return undefined
}

// A search loads a tool unless an earlier one already has, so each step
// calls its tool whatever the search found.
export const ask: Scenario = {
  start: () => call('tool_search', { query: 'unlock' }),
  replies: {
    tool_search: (output, context) => {
      switch (lastQuery(context)) {
        case 'unlock':
          return call('mcp__home-assistant__unlock', {
            entity_id: 'lock.front_door',
          })
        case 'print spool':
          return call('mcp__bench__start_print', { file: 'benchy.gcode' })
        default:
          return mcp.replies!.tool_search!(output, context)
      }
    },
    'mcp__home-assistant__unlock': () =>
      call('tool_search', { query: 'print spool' }),
    mcp__bench__start_print: () => call('mcp__bench__log_spool'),
    mcp__bench__log_spool: (output) =>
      fauxAssistantMessage(
        `That's every kind of question. The bench said: ${output}`,
      ),
  },
}
