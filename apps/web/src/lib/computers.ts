import type { ConnectionInfo, FamiliarSummary } from '@familiar-ai/client'
import { queryOptions, useQuery } from '@tanstack/react-query'
import type { Tone } from '@/components/status-dot'
import { capabilitiesKey, useFamiliarStore } from './familiar'
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
 * Whether the nearest Familiar has a computer: its `computer` capability,
 * from the same query its settings' switches use. Undefined until known.
 */
export const useHasComputer = (familiar: FamiliarSummary['id']) => {
  const store = useFamiliarStore()
  return useQuery({
    queryKey: capabilitiesKey(familiar),
    queryFn: () => store.capabilities.get(),
    select: (capabilities) =>
      capabilities.plugins.includes(computerPlugin.name),
  }).data
}

/** How each state of a computer reads at a glance. */
export const computerStates: Record<
  ComputerStatus['state'],
  { label: string; tone: Tone }
> = {
  running: { label: 'Running', tone: 'ok' },
  asleep: { label: 'Asleep', tone: 'off' },
  'setting-up': { label: 'Setting up', tone: 'busy' },
  // None yet: its host hasn't made it since the capability came on.
  none: { label: 'Setting up', tone: 'busy' },
  unavailable: { label: 'Unavailable', tone: 'bad' },
}

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
 * Where a Familiar's screen streams: a WebSocket of its display's VNC, for
 * noVNC, on this page's own origin.
 */
export const screenUrl = (familiar: FamiliarSummary['id']) => {
  const url = new URL(
    `/api/plugins/computer/familiars/${familiar}/screen`,
    window.location.href,
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** Some amount in use against its limit, such as memory in bytes. */
export type Usage = { used: number; limit?: number }

/** A call running on a computer: its tool and a short target, such as the URL or command. */
export type ComputerCall = { tool: string; target?: string }

/**
 * A Familiar's computer in detail, as its host reports it (the computer
 * package's `ComputerDetail`). Every field is optional: each host fills in
 * what it can tell. Times are ISO 8601.
 */
export type ComputerDetail = {
  status?: ComputerStatus
  doing?: ComputerCall[]
  /** When it last started, or while asleep, when it went to sleep. */
  since?: string
  /** When its last call ended, if none is running. */
  lastUsed?: string
  /** CPUs. */
  cpu?: Usage
  /** Bytes. */
  memory?: Usage
  processes?: Usage
  /** Bytes. */
  disk?: Usage
  /** The most memory (bytes) first. */
  programs?: { command: string; memory?: number }[]
  tabs?: { title: string; url: string }[]
  system?: { os?: string; architecture?: string }
}

/**
 * A Familiar's computer in detail, read only while someone looks at it:
 * use it only in what's shown then. Refreshed every few seconds.
 */
export const computerDetailQuery = (familiar: FamiliarSummary['id']) =>
  queryOptions({
    queryKey: [...capabilitiesKey(familiar), 'computer', 'detail'],
    queryFn: async () => {
      const response = await fetch(
        `/api/plugins/computer/familiars/${familiar}/inspect`,
      )
      await check(response)
      return (await response.json()) as ComputerDetail
    },
    refetchInterval: 3000,
    // Never a stale look from the last time it was open.
    gcTime: 0,
  })

/** One Familiar's computer in the overview. */
export type ComputerSummary = Pick<
  ComputerDetail,
  'doing' | 'since' | 'lastUsed'
> & { familiar: FamiliarSummary['id']; state: 'running' | 'asleep' }

/**
 * Every Familiar's computer, from the host the daemon holds, and how many
 * it allows. Null where nothing serves it.
 */
export const computersQuery = queryOptions({
  queryKey: ['computers'],
  queryFn: async () => {
    const response = await fetch('/api/computers')
    if (response.status === 404) {
      return null
    }
    await check(response)
    return (await response.json()) as {
      max?: number
      computers: ComputerSummary[]
    }
  },
  refetchInterval: 5000,
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

/** An address's site, such as `example.com`, or the address itself. */
const siteOf = (url: string) => (URL.canParse(url) && new URL(url).host) || url

const calls: Record<string, (target?: string) => string> = {
  browser_navigate: (url) =>
    url ? `Opening ${siteOf(url)}` : 'Opening a page',
  browser_snapshot: () => 'Reading the page',
  browser_screenshot: () => 'Looking at the page',
  browser_click: () => 'Clicking on the page',
  browser_type: () => 'Typing on the page',
  screen_screenshot: () => 'Looking at the screen',
  screen_click: () => 'Clicking on the screen',
  screen_type: () => 'Typing on the screen',
  screen_key: (keys) => (keys ? `Pressing ${keys}` : 'Pressing keys'),
  screen_scroll: () => 'Scrolling the screen',
  run_command: (command) =>
    command ? `Running ${command}` : 'Running a command',
  read_file: (path) => (path ? `Reading ${path}` : 'Reading a file'),
  write_file: (path) => (path ? `Writing ${path}` : 'Writing a file'),
}

/** What a call is doing, in words: `Opening example.com`. */
export const describeCall = ({ tool, target }: ComputerCall) =>
  calls[tool]?.(target) ?? (target ? `${tool}: ${target}` : tool)

/**
 * Programs by executable, such as Chromium's many processes as one `chrome`,
 * with how many run and their memory together, the most memory first.
 */
export const programsByName = (
  programs: NonNullable<ComputerDetail['programs']>,
) => {
  const named = new Map<
    string,
    { name: string; count: number; memory?: number }
  >()
  for (const { command, memory } of programs) {
    const name = command.split(' ')[0]!.split('/').at(-1)!
    const group =
      named.get(name) ?? named.set(name, { name, count: 0 }).get(name)!
    group.count++
    if (memory !== undefined) {
      group.memory = (group.memory ?? 0) + memory
    }
  }
  return [...named.values()].sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0))
}
