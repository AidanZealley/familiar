import { useMutationState } from '@tanstack/react-query'
import { ModelPicker } from '@/components/chat/components/model-picker'

/** The composer's model picker, for a Familiar whose DM isn't open. */
export const ModelSettings = () => {
  const error = useMutationState({
    filters: { mutationKey: ['model'] },
    select: (mutation) => mutation.state.error,
  }).at(-1)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ModelPicker place="settings" />
      </div>
      <p className="text-xs text-muted-foreground">
        More reasoning answers better, and slower.
      </p>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </div>
  )
}
