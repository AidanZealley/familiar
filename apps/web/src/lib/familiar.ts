import { createFamiliarStore, type FamiliarState } from '@familiar-ai/client'
import { MutationCache, QueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'

/**
 * The app's one connection, open for its lifetime. It owns everything the
 * event stream sends. Call commands on it directly, such as
 * `familiar.conversation.send(text)`.
 */
export const familiar = createFamiliarStore('/api')

/** Selects from the store's state, re-rendering when the selection changes. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T =>
  useStore(familiar, selector)

/**
 * Owns request state: what the app fetches instead of mirroring, such as
 * connections, and each command's progress and failure. A command that
 * succeeds refreshes the queries that share its key: one with
 * `mutationKey: ['connections']` refreshes `['connections']`.
 */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _result, mutation, { client }) =>
      mutation.options.mutationKey &&
      client.invalidateQueries({ queryKey: mutation.options.mutationKey }),
  }),
})
