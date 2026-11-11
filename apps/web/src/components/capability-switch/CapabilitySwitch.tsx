import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Switch } from '@/components/ui/switch'
import type { CapabilitySwitchProps } from './types'

/**
 * Whether a Familiar, or each new one, uses a connection. Each opts in, so
 * a Familiar added later is off until it's switched on. One change at a
 * time per source: each replaces a whole list, so it starts from the last.
 */
export const CapabilitySwitch = ({
  connection,
  source,
  label,
}: CapabilitySwitchProps) => {
  const client = useQueryClient()
  const kind = connection.kind === 'plugin' ? 'plugins' : 'mcp'
  const capabilities = useQuery({ queryKey: source.key, queryFn: source.get })
  const changing = useIsMutating({ mutationKey: source.key }) > 0
  const change = useMutation({
    mutationKey: source.key,
    mutationFn: (on: boolean) => {
      const used = capabilities.data?.[kind] ?? []
      const next = on
        ? [...used, connection.name]
        : used.filter((other) => other !== connection.name)
      return source.set({ [kind]: next })
    },
    onSettled: () => client.invalidateQueries({ queryKey: source.key }),
  })
  const on = capabilities.data?.[kind].includes(connection.name) ?? false
  const error = capabilities.error ?? change.error

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        aria-label={label}
        checked={change.isPending ? change.variables : on}
        disabled={!capabilities.data || changing || capabilities.isFetching}
        onCheckedChange={(checked) => change.mutate(checked)}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      )}
    </div>
  )
}
