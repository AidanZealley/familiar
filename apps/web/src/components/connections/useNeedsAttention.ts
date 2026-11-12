import { useQuery } from '@tanstack/react-query'
import { connectionsQuery } from './query'
import { needsAttention } from './status'

/** How many connections need the owner: failed, refused, closed or keyless. */
export const useNeedsAttention = () =>
  useQuery({
    ...connectionsQuery,
    select: (connections) => connections.filter(needsAttention).length,
  }).data ?? 0
