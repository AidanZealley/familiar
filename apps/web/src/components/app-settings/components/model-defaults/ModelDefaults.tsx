import type { ModelDefaultsChange } from '@familiar-ai/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ModelSelect } from '@/components/model-select'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { modelDefaultsQuery } from '@/lib/models'

/** What every Familiar's chat and memory run on unless it has its own. */
export const ModelDefaults = () => {
  const client = useQueryClient()
  const { data: defaults, error } = useQuery(modelDefaultsQuery)
  const save = useMutation({
    mutationKey: modelDefaultsQuery.queryKey,
    mutationFn: (change: ModelDefaultsChange) =>
      workspace.defaults.setModels(change),
    onSettled: () =>
      client.invalidateQueries({ queryKey: modelDefaultsQuery.queryKey }),
  })

  if (!defaults) {
    return error && <FieldError>{error.message}</FieldError>
  }

  return (
    <div className="flex flex-col gap-6 text-sm">
      <Field>
        <FieldLabel>Chat model</FieldLabel>
        <FieldDescription>What Familiars answer with.</FieldDescription>
        <ModelSelect
          options={defaults.options}
          value={defaults.chat}
          onChange={(chat) => chat && save.mutate({ chat })}
          disabled={save.isPending}
        />
      </Field>
      <Field>
        <FieldLabel>Memory model</FieldLabel>
        <FieldDescription>
          What Familiars file their conversations with each night. A smaller
          model costs less.
        </FieldDescription>
        <ModelSelect
          options={defaults.options}
          value={defaults.memory}
          onChange={(memory) => memory && save.mutate({ memory })}
          disabled={save.isPending}
        />
      </Field>
      <FieldError>{save.error?.message}</FieldError>
    </div>
  )
}
