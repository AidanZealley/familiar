import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models'
import { defineDocFamily, type ModelRef } from '@earendil-works/pi-durable'

/**
 * A model the installation offers, and the reasoning level it starts on.
 * Chats switch between these, and memory's calls may run on one.
 */
export type ModelChoice = {
  model: ModelRef
  thinkingLevel: ModelThinkingLevel
}

/** A model choice as clients offer it: its name and the levels it supports. */
export type ModelOption = ModelChoice & {
  name: string
  thinkingLevels: ModelThinkingLevel[]
}

/** A change of model or level the model choices refuse; nothing was changed. */
export class ModelError extends Error {}

/** How Pi keys a model, e.g. in `compaction.modelOverrides`. */
export const modelKey = (model: ModelRef) =>
  `${model.provider}/${model.modelId}`

/**
 * The level last picked for each model choice, by `modelKey`. Only models whose
 * level was changed are here; the rest start on their own default.
 */
export type ThinkingLevelsState = Record<string, ModelThinkingLevel>

export const ThinkingLevels = defineDocFamily<ThinkingLevelsState, null>({
  kind: 'familiar.thinking-levels',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/** The model choices that `models` knows, with what clients show for each. */
export function modelOptions(
  models: Models,
  modelChoices: readonly ModelChoice[],
): ModelOption[] {
  return modelChoices.map((choice) => {
    const model = models.getModel(choice.model.provider, choice.model.modelId)
    if (!model) {
      throw new Error(`${modelKey(choice.model)} is not in the catalog.`)
    }
    return {
      ...choice,
      name: model.name,
      thinkingLevels: getSupportedThinkingLevels(model),
    }
  })
}

/** `model`'s choice, or undefined if it isn't one. */
export const findModelChoice = <T extends ModelChoice>(
  modelChoices: readonly T[],
  model: ModelRef | undefined,
) =>
  model &&
  modelChoices.find((choice) => modelKey(choice.model) === modelKey(model))
