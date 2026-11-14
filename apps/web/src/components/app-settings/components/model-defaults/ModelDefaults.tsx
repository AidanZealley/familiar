import type { ModelDefaultsChange } from '@familiar-ai/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FieldError } from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { modelDefaultsQuery } from '@/lib/models'
import { DefaultModel } from './components/default-model'

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
      <DefaultModel
        label="Chat model"
        description="What Familiars answer with. More reasoning answers better, and slower."
        options={defaults.options}
        value={defaults.chat}
        onChange={(chat) => save.mutate({ chat })}
        disabled={save.isPending}
      />
      <DefaultModel
        label="Memory model"
        description="What Familiars file their conversations with each night. A smaller model costs less."
        options={defaults.options}
        value={defaults.memory}
        onChange={(memory) => save.mutate({ memory })}
        disabled={save.isPending}
      />
      <FieldError>{save.error?.message}</FieldError>
    </div>
  )
}
