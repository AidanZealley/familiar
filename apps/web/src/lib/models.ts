import type { ModelRef } from '@familiar-ai/client'
import { useQuery } from '@tanstack/react-query'
import { useFamiliarStore } from './familiar'

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
