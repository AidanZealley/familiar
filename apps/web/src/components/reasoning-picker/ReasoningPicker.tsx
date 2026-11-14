import type { ModelThinkingLevel } from '@familiar-ai/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ReasoningSelect } from '@/components/reasoning-select'
import { useFamiliar, useFamiliarStore } from '@/lib/familiar'
import {
  defaultLevel,
  keyOf,
  modelDefaultsQuery,
  useModelOptions,
} from '@/lib/models'
import type { ReasoningPickerProps } from './types'

/**
 * The reasoning level of the nearest Familiar's chat, for the model it's
 * on. A level picked here is remembered for that model, over the default.
 */
export const ReasoningPicker = ({ place }: ReasoningPickerProps) => {
  const familiar = useFamiliarStore()
  const options = useModelOptions()
  const { data: defaults } = useQuery(modelDefaultsQuery)
  const setLevel = useMutation({
    mutationKey: [place === 'composer' ? 'composer' : 'model'],
    mutationFn: (level: ModelThinkingLevel) =>
      familiar.model.setThinkingLevel(level),
  })
  // Live from the conversation, so a change on another device shows here.
  const agent = useFamiliar((state) => state.model)
  const current =
    agent?.model &&
    options?.find((option) => keyOf(option.model) === keyOf(agent.model!))

  if (!current || !agent?.thinkingLevel) {
    return null
  }

  return (
    <ReasoningSelect
      levels={current.thinkingLevels}
      value={agent.thinkingLevel}
      defaultLevel={defaultLevel(current, defaults?.chat)}
      onChange={(level) => setLevel.mutate(level)}
      place={place}
    />
  )
}
