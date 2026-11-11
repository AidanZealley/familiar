import type { Provider } from '@earendil-works/pi-ai/models'
import type { ChatModel } from '@familiar-ai/core'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import {
  scriptedModels,
  type ScriptedRequest,
} from '@familiar-ai/core/models/scripted'
import { SEED_MESSAGE } from './household/memory.ts'
import type { DemoClock } from './clock.ts'
import type { Script } from './household/script.ts'
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

/** The scenarios' answers to anything the household's script doesn't cover. */
function scenarioReply(request: ScriptedRequest) {
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

const fauxModels = [
  { id: 'faux-1', name: 'Faux One', reasoning: true },
  { id: 'faux-2', name: 'Faux Two', reasoning: true },
]

/**
 * Signing in to the demo's provider: it asks for nothing and stores a login
 * that never expires, in memory. Requests need it as they would a real
 * provider's, so the model account can be signed out of and back into.
 */
const demoLogin: NonNullable<Provider['auth']['oauth']> = {
  name: 'Faux',
  login: async () => ({
    type: 'oauth',
    access: 'faux',
    refresh: 'faux',
    expires: Number.MAX_SAFE_INTEGER,
  }),
  refresh: async (credential) => credential,
  toAuth: async () => ({}),
}

/**
 * The demo's models: the household's script, else the scenarios, each reply
 * dated by the demo's clock. Replies stream at a readable pace, but fast
 * enough that a whole one doesn't drag, except while the clock is catching
 * up: the seed writing the household's history, which nobody watches, gets
 * them at once.
 */
export function createDemoModels(script: Script, clock: DemoClock) {
  const respond = async (request: ScriptedRequest) => ({
    ...(await (script.reply(request) ?? scenarioReply(request))),
    timestamp: clock.now(),
  })
  const models = scriptedModels(respond, {
    tokensPerSecond: 40,
    models: fauxModels,
  })
  const paced = models.getProvider('faux')!
  const instant = scriptedModels(respond, { models: fauxModels }).getProvider(
    'faux',
  )!
  const current = () => (clock.catchingUp() ? instant : paced)
  models.setProvider(
    Object.assign(Object.create(paced), {
      auth: { oauth: demoLogin },
      stream: (...args: Parameters<typeof paced.stream>) =>
        current().stream(...args),
      streamSimple: (...args: Parameters<typeof paced.streamSimple>) =>
        current().streamSimple(...args),
    }),
  )
  return models
}
