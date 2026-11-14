import type { ModelSetting } from '@familiar-ai/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ModelSelect } from '@/components/model-select'
import { ReasoningSelect } from '@/components/reasoning-select'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { defaultLevel, keyOf, modelDefaultsQuery } from '@/lib/models'
import type { MemoryModelProps } from './types'

/**
 * The model and reasoning level this Familiar's memory filing and
 * consolidation run on. It saves as soon as one is picked and applies from
 * the next call. Picking a level while on the default chooses the default's
 * model with it.
 */
export const MemoryModel = ({ familiar }: MemoryModelProps) => {
  const { data: defaults } = useQuery(modelDefaultsQuery)
  const save = useMutation({
    mutationKey: ['familiar', familiar.id],
    mutationFn: (memoryModel: ModelSetting | null) =>
      workspace.familiars.update(familiar.id, { memoryModel }),
  })

  if (!defaults) {
    return null
  }
  const find = (model: ModelSetting | undefined) =>
    model &&
    defaults.options.find((option) => keyOf(option.model) === keyOf(model))
  // A model that is no longer offered counts as none: memory ignores it too.
  const own = find(familiar.memoryModel)
  const option = own ?? find(defaults.memory)
  const fallbackLevel = option && defaultLevel(option, defaults.memory)
  const chosenLevel = own && familiar.memoryModel?.thinkingLevel
  const level =
    own && chosenLevel && own.thinkingLevels.includes(chosenLevel)
      ? chosenLevel
      : fallbackLevel

  return (
    <Field>
      <FieldLabel>Memory model</FieldLabel>
      <FieldDescription>
        What {familiar.name} files its conversations with each night.
      </FieldDescription>
      <div className="flex flex-wrap gap-2">
        <ModelSelect
          options={defaults.options}
          value={own ? own.model : null}
          fallback={defaults.memory}
          onChange={(model) => save.mutate(model)}
          disabled={save.isPending}
        />
        {option && level && fallbackLevel && (
          <ReasoningSelect
            levels={option.thinkingLevels}
            value={level}
            defaultLevel={fallbackLevel}
            onChange={(thinkingLevel) =>
              save.mutate({ ...option.model, thinkingLevel })
            }
            disabled={save.isPending}
          />
        )}
      </div>
      <FieldError>{save.error?.message}</FieldError>
    </Field>
  )
}
