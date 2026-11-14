import type { ModelRef } from '@familiar-ai/client'
import { useMutation, useMutationState, useQuery } from '@tanstack/react-query'
import { ModelSelect } from '@/components/model-select'
import { ReasoningPicker } from '@/components/reasoning-picker'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { workspace } from '@/lib/familiar'
import { modelDefaultsQuery } from '@/lib/models'
import type { ChatModelProps } from './types'

/**
 * The model this Familiar answers with, and its reasoning level. Also in
 * its DM's composer, where picking a model gives it its own too.
 */
export const ChatModel = ({ familiar }: ChatModelProps) => {
  const { data: defaults } = useQuery(modelDefaultsQuery)
  const save = useMutation({
    mutationKey: ['model'],
    mutationFn: (chatModel: ModelRef | null) =>
      workspace.familiars.update(familiar.id, { chatModel }),
  })
  // The reasoning menu's failures too.
  const error = useMutationState({
    filters: { mutationKey: ['model'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)

  if (!defaults) {
    return null
  }

  return (
    <Field>
      <FieldLabel>Chat model</FieldLabel>
      <FieldDescription>
        What {familiar.name} answers with. More reasoning answers better, and
        slower.
      </FieldDescription>
      <div className="flex flex-wrap gap-2">
        <ModelSelect
          options={defaults.options}
          value={familiar.chatModel ?? null}
          fallback={defaults.chat}
          onChange={(model) => save.mutate(model)}
          disabled={save.isPending}
        />
        <ReasoningPicker place="settings" />
      </div>
      <FieldError>{error?.message}</FieldError>
    </Field>
  )
}
