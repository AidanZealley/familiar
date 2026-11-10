import { useMutation, useQuery } from '@tanstack/react-query'
import { Switch } from '@/components/ui/switch'
import { familiar, familiarId, useWorkspace } from '@/lib/familiar'
import type { FamiliarSwitchProps } from './types'

/**
 * Whether the app's Familiar uses this connection. Each Familiar opts in,
 * so one added later is off until it's switched on here.
 */
export const FamiliarSwitch = ({ connection }: FamiliarSwitchProps) => {
  const name = useWorkspace(
    (state) => state.familiars?.familiars[familiarId()]?.name,
  )
  const kind = connection.kind === 'plugin' ? 'plugins' : 'mcp'
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => familiar().capabilities.get(),
  })
  const change = useMutation({
    mutationKey: ['capabilities'],
    mutationFn: (on: boolean) => {
      const used = capabilities.data?.[kind] ?? []
      return familiar().capabilities.set({
        [kind]: on
          ? [...used, connection.name]
          : used.filter((other) => other !== connection.name),
      })
    },
  })
  const on = capabilities.data?.[kind].includes(connection.name) ?? false

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          checked={change.isPending ? change.variables : on}
          disabled={!capabilities.data || change.isPending}
          onCheckedChange={(checked) => change.mutate(checked)}
        />
        Used by {name ?? 'your Familiar'}
      </label>
      {(capabilities.error ?? change.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(capabilities.error ?? change.error)?.message}
        </p>
      )}
    </div>
  )
}
