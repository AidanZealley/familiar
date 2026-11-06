import type { ChatModel } from '@familiar-ai/core'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'

/** A scripted model that echoes, so the example needs no model key. */
export const ECHO_MODEL: ChatModel = {
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'low',
}

export const echoModels = () =>
  scriptedModels((request) =>
    fauxAssistantMessage(
      request.type === 'message' ? `You said: ${request.text}` : 'Done.',
    ),
  )
