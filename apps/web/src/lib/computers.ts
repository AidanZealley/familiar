import type { ConnectionInfo, FamiliarSummary } from '@familiar-ai/client'
import { queryOptions } from '@tanstack/react-query'
import { capabilitiesKey } from './familiar'
import { check } from './http'

/** The computer plugin, which a Familiar's `computer` capability turns on. */
export const computerPlugin = { kind: 'plugin', name: 'computer' } as const

/** Whether a connection is the computer plugin. */
export const isComputer = ({
  kind,
  name,
}: Pick<ConnectionInfo, 'kind' | 'name'>) =>
  kind === computerPlugin.kind && name === computerPlugin.name

/** A Familiar's computer, as the plugin's host reports it. */
export type ComputerStatus =
  | { state: 'running' | 'asleep' | 'setting-up' | 'none' }
  | { state: 'unavailable'; reason: string }

/**
 * A Familiar's computer. Under its capabilities' key, so turning the
 * capability on or off refreshes it. Polled while shown, since a computer
 * sleeps and wakes by itself, and quickly while its image downloads.
 */
export const computerQuery = (familiar: FamiliarSummary['id']) =>
  queryOptions({
    queryKey: [...capabilitiesKey(familiar), 'computer'],
    queryFn: async () => {
      const response = await fetch(
        `/api/plugins/computer/familiars/${familiar}/status`,
      )
      await check(response)
      return (await response.json()) as ComputerStatus
    },
    refetchInterval: (query) =>
      query.state.data?.state === 'setting-up' ? 1000 : 5000,
  })

/**
 * How many computers Familiars may have, which the daemon keeps. Null where
 * nothing serves it: the host sets its own.
 */
export const computerLimitQuery = queryOptions({
  queryKey: ['computer-limit'],
  queryFn: async (): Promise<number | null> => {
    const response = await fetch('/api/computer-limit')
    if (response.status === 404) {
      return null
    }
    await check(response)
    return ((await response.json()) as { maxComputers: number }).maxComputers
  },
})

/** Replaces the limit. Lowering it removes no computer; it only stops new ones. */
export async function setComputerLimit(maxComputers: number) {
  await check(
    await fetch('/api/computer-limit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxComputers }),
    }),
  )
}
