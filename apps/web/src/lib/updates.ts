import { queryOptions } from '@tanstack/react-query'
import { check } from './http'

/** Where an installation updates from, as the daemon names it. */
export type UpdateSource = 'release' | 'main'

/** The current or last update, as the daemon's `/api/update` reports it. */
export type LastUpdate = {
  source: UpdateSource
  from: string
  /** The version installed, once it is. */
  to?: string
  phase:
    | 'downloading'
    | 'installing'
    | 'restarting'
    | 'done'
    | 'failed'
    | 'interrupted'
  error?: string
  /** The end of the update's log, when it failed. */
  log?: string
  startedAt: string
  endedAt?: string
}

/** What the daemon says about updating its installation. */
export type UpdateInfo = {
  /** The package the daemon runs, or null for a source checkout. */
  installed: { version: string; source: UpdateSource } | null
  /** Whether the daemon is the service, which an update restarts. */
  service: boolean
  last: LastUpdate | null
  /** When the daemon started, which changes when it restarts. */
  started: string
}

export const sourceNames: Record<UpdateSource, string> = {
  release: 'Latest release',
  main: 'Latest build of main',
}

/** Whether an update is still going. */
export const isUpdating = (last: LastUpdate | null | undefined) =>
  last?.phase === 'downloading' ||
  last?.phase === 'installing' ||
  last?.phase === 'restarting'

/** What the daemon says about its installation, or null if nothing serves it. */
async function fetchInfo(signal?: AbortSignal): Promise<UpdateInfo | null> {
  const response = await fetch('/api/update', { signal })
  if (response.status === 404) {
    return null
  }
  await check(response)
  return (await response.json()) as UpdateInfo
}

/** The version the daemon ran when this page loaded, which its code is. */
let pageVersion: string | undefined

/**
 * The version to reload for, once the daemon runs another than this page
 * was loaded from.
 */
export const reloadFor = (info: UpdateInfo) =>
  info.installed && pageVersion && info.installed.version !== pageVersion
    ? info.installed.version
    : undefined

/**
 * The installation's version and its current or last update. Null where
 * nothing serves it: a host that updates itself. Polled while an update
 * runs, through the daemon's restart: a failed poll keeps the last answer,
 * so it keeps polling until the daemon is back.
 */
export const updateQuery = queryOptions({
  queryKey: ['update'],
  queryFn: async () => {
    const info = await fetchInfo()
    pageVersion ??= info?.installed?.version
    return info
  },
  retry: false,
  refetchInterval: (query) =>
    isUpdating(query.state.data?.last) ? 1000 : false,
})

/** The latest version each source offers; one is missing if unknown. */
export const availableQuery = queryOptions({
  queryKey: ['update-available'],
  queryFn: async () => {
    const response = await fetch('/api/update/available')
    await check(response)
    return (await response.json()) as Partial<Record<UpdateSource, string>>
  },
  staleTime: 60_000,
})

/** Starts updating from `source`, as its own job beside the daemon. */
export async function startUpdate(source: UpdateSource) {
  await check(
    await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  )
}

/** How long a restart may take before the page stops waiting for it. */
const RESTART_LIMIT_MS = 120_000

/**
 * Restarts the daemon's service, as its own job beside it, and resolves
 * once a daemon started after `started` (the one asked) answers. Throws if
 * the daemon refuses, or if none answers within `RESTART_LIMIT_MS`.
 */
export async function restartFamiliar(started: string) {
  const signal = AbortSignal.timeout(RESTART_LIMIT_MS)
  let response: Response | undefined
  try {
    response = await fetch('/api/update/restart', { method: 'POST', signal })
  } catch {
    // The restart can stop the daemon before its answer arrives: wait and see.
  }
  if (response) {
    await check(response)
    // The daemon that accepted it, newer than the page's if it restarted since.
    ;({ started } = (await response.json()) as { started: string })
  }
  try {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      signal.throwIfAborted()
      // Until the new daemon listens, requests fail.
      const info = await fetchInfo(signal).catch(() => undefined)
      if (info && info.started !== started) {
        return
      }
    }
  } catch {
    throw new Error(
      "Familiar hasn't come back. Run familiar logs on the machine it runs on to see why.",
    )
  }
}
