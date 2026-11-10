import type { ChatModel } from '@familiar-ai/core'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import {
  scriptedModels,
  type ScriptedRequest,
} from '@familiar-ai/core/models/scripted'
import { SEED_MESSAGE } from './scenarios/seed.ts'
import { markdownReply, tool, slow, error } from './scenarios/chat.ts'
import { compact } from './scenarios/compaction.ts'
import { key } from './scenarios/connections.ts'
import { mcp } from './scenarios/mcp.ts'
import { memory, seed } from './scenarios/memory.ts'
import { remind, scheduledReply } from './scenarios/schedules.ts'
import type { Scenario } from './scenarios/scenario.ts'

const scenarios = { tool, memory, remind, key, mcp, slow, compact, error }
const replies: NonNullable<Scenario['replies']> = Object.assign(
  {},
  ...[...Object.values(scenarios), seed].map((scenario) => scenario.replies),
)

export function reply(request: ScriptedRequest) {
  switch (request.type) {
    case 'background':
      return fauxAssistantMessage('The person tried the demo scenarios.')
    case 'scheduled':
      return scheduledReply()
    case 'handoff':
      return fauxAssistantMessage(`${request.from} asked: ${request.note}`)
    case 'tool-result':
      return (
        replies[request.name]?.(request.output, request.context) ??
        fauxAssistantMessage(request.output)
      )
    case 'message': {
      if (request.text === SEED_MESSAGE) {
        return seed.start()
      }
      const matched = Object.entries(scenarios).find(([word]) =>
        new RegExp(`\\b${word}\\b`).test(request.text.toLowerCase()),
      )
      return matched ? matched[1].start() : fauxAssistantMessage(markdownReply)
    }
  }
}

/** Two scripted models that answer alike, so the model picker has a choice. */
export const demoChatModels: ChatModel[] = [
  { model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'low' },
  { model: { provider: 'faux', modelId: 'faux-2' }, thinkingLevel: 'medium' },
]

// Readable, but fast enough that a whole reply doesn't drag.
export const createDemoModels = () =>
  scriptedModels(reply, {
    tokensPerSecond: 40,
    models: [
      { id: 'faux-1', name: 'Faux One', reasoning: true },
      { id: 'faux-2', name: 'Faux Two', reasoning: true },
    ],
  })
