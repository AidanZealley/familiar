import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models'
import { defineDoc, type ModelRef } from '@earendil-works/pi-durable'

/** A model the conversation may switch to, and the reasoning level it starts on. */
export type ChatModel = {
  model: ModelRef
  thinkingLevel: ModelThinkingLevel
}

/** A chat model as clients offer it: its name and the levels it supports. */
export type ModelOption = ChatModel & {
  name: string
  thinkingLevels: ModelThinkingLevel[]
}

/** A change of model or level the chat models refuse; nothing was changed. */
export class ModelError extends Error {}

/** How Pi keys a model, e.g. in `compaction.modelOverrides`. */
export const modelKey = (model: ModelRef) =>
  `${model.provider}/${model.modelId}`

/**
 * The level last picked for each chat model, by `modelKey`. Only models whose
 * level was changed are here; the rest start on their own default.
 */
export type ThinkingLevelsState = Record<string, ModelThinkingLevel>

export const ThinkingLevels = defineDoc<ThinkingLevelsState>({
  kind: 'familiar.thinking-levels',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/** The chat models that `models` knows, with what clients show for each. */
export function modelOptions(
  models: Models,
  chatModels: readonly ChatModel[],
): ModelOption[] {
  return chatModels.map((chatModel) => {
    const model = models.getModel(
      chatModel.model.provider,
      chatModel.model.modelId,
    )
    if (!model) {
      throw new Error(`${modelKey(chatModel.model)} is not in the catalog.`)
    }
    return {
      ...chatModel,
      name: model.name,
      thinkingLevels: getSupportedThinkingLevels(model),
    }
  })
}

/** `model`'s chat model, or undefined if it isn't one. */
export const findChatModel = <T extends ChatModel>(
  chatModels: readonly T[],
  model: ModelRef | undefined,
) =>
  model &&
  chatModels.find((chatModel) => modelKey(chatModel.model) === modelKey(model))
