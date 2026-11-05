import type { ChatModel } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseFactory,
} from '@familiar-ai/core/models/faux'

/** A scripted model that echoes, so the example needs no model key. */
export const ECHO_MODEL: ChatModel = {
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'low',
}

export function echoModels() {
  const faux = fauxProvider()
  // Answers from a queue; this step queues itself again so it never runs out.
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond])
    const said = context.messages.findLast((message) => message.role === 'user')
    const text =
      typeof said?.content === 'string'
        ? said.content
        : (said?.content ?? [])
            .map((part) => ('text' in part ? part.text : ''))
            .join('')
    // Only the person's words, after the line naming them.
    return fauxAssistantMessage(
      `You said: ${text.replace(/^\[Message from .*\n/, '')}`,
    )
  }
  faux.setResponses([respond])
  const models = createModels()
  models.setProvider(faux.provider)
  return models
}
