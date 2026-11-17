import type { ConnectionInfo } from '@familiar-ai/client'
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { CapabilitySource } from './types'

/**
 * Whether `source` uses one connection, and a change to it. One change at a
 * time per source: each replaces a whole list, so it starts from the last.
 * While a change runs, `on` is what it sets.
 */
export const useCapability = (
  source: CapabilitySource,
  { kind, name }: Pick<ConnectionInfo, 'kind' | 'name'>,
) => {
  const client = useQueryClient()
  const list = kind === 'plugin' ? 'plugins' : 'mcp'
  const capabilities = useQuery({ queryKey: source.key, queryFn: source.get })
  const changing = useIsMutating({ mutationKey: source.key }) > 0
  const change = useMutation({
    mutationKey: source.key,
    mutationFn: (on: boolean) => {
      const used = capabilities.data?.[list] ?? []
      const next = on ? [...used, name] : used.filter((other) => other !== name)
      return source.set({ [list]: next })
    },
    onSettled: () => client.invalidateQueries({ queryKey: source.key }),
  })

  return {
    /** Undefined until it's known. */
    on: change.isPending
      ? change.variables
      : capabilities.data?.[list].includes(name),
    set: (on: boolean) => change.mutate(on),
    /** Unknown, or changing. */
    busy: !capabilities.data || changing || capabilities.isFetching,
    error: capabilities.error ?? change.error,
  }
}
