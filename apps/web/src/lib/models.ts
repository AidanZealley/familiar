import type { ModelOption, ModelRef, ModelSetting } from '@familiar-ai/client'
import { useQuery } from '@tanstack/react-query'
import { useFamiliarStore, workspace } from './familiar'

/** How the app keys a model, to match a choice to the one in use. */
export const keyOf = (model: ModelRef) => `${model.provider}/${model.modelId}`

/**
 * The models the nearest Familiar may use, with their names and reasoning
 * levels. Fixed for the daemon's lifetime, so fetched once rather than
 * mirrored.
 */
export const useModelOptions = () => {
  const familiar = useFamiliarStore()
  return useQuery({
    queryKey: ['models'],
    queryFn: () => familiar.model.options(),
    staleTime: Infinity,
  }).data
}

/**
 * The workspace's default models, and every model they and a Familiar may
 * choose from. Changed only from Settings, which refetches it.
 */
export const modelDefaultsQuery = {
  queryKey: ['model-defaults'],
  queryFn: () => workspace.defaults.models(),
}

/**
 * The level `option` runs at for a job unless one is picked: the job's
 * default level if it's the default model, else its own. Core decides the
 * same way (packages/core/src/workspace/models.ts).
 */
export const defaultLevel = (
  option: ModelOption,
  fallback: Required<ModelSetting> | undefined,
) =>
  fallback && keyOf(fallback) === keyOf(option.model)
    ? fallback.thinkingLevel
    : option.thinkingLevel
