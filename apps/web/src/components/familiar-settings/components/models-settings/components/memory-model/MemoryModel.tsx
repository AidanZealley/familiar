import type { ModelRef } from '@familiar-ai/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ModelSelect } from '@/components/model-select'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { modelDefaultsQuery } from '@/lib/models'
import type { MemoryModelProps } from './types'

/**
 * The model this Familiar's memory filing and consolidation run on. It
 * saves as soon as one is picked and applies from the next call.
 */
export const MemoryModel = ({ familiar }: MemoryModelProps) => {
  const { data: defaults } = useQuery(modelDefaultsQuery)
  const save = useMutation({
    mutationKey: ['familiar', familiar.id],
    mutationFn: (memoryModel: ModelRef | null) =>
      workspace.familiars.update(familiar.id, { memoryModel }),
  })

  if (!defaults) {
    return null
  }

  return (
    <Field>
      <FieldLabel>Memory model</FieldLabel>
      <FieldDescription>
        What {familiar.name} files its conversations with each night.
      </FieldDescription>
      <ModelSelect
        options={defaults.options}
        value={familiar.memoryModel ?? null}
        fallback={defaults.memory}
        onChange={(model) => save.mutate(model)}
        disabled={save.isPending}
      />
      <FieldError>{save.error?.message}</FieldError>
    </Field>
  )
}
