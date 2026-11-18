import type { CallToolResult, Client } from '@modelcontextprotocol/client'
import type { ComputerDetail } from '../host.ts'
import { INFO_TOOL, type ComputerInfo } from '../tools.ts'
import { docker, HOME } from './resources.ts'

/** Longer and the disk is left out, so a big home never slows the popover. */
const DISK_MAX_SECONDS = 1
/** How long a look waits for an agent's activity, tabs and system. */
const INFO_MAX_MS = 2000
const PROGRAMS_MAX = 50
const COMMAND_MAX = 120

/** Docker's sizes, such as `1.5GiB` or `900kB`, in bytes. */
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 2 ** 10,
  mib: 2 ** 20,
  gib: 2 ** 30,
  tib: 2 ** 40,
}
export function bytesOf(size: string) {
  const [, amount, unit] = /^([\d.]+)\s*([a-z]+)$/i.exec(size.trim()) ?? []
  const scale = unit && UNITS[unit.toLowerCase()]
  return amount && scale ? Math.round(Number(amount) * scale) : undefined
}

/** A Docker time, unless it's the zero time of something that never happened. */
const timeOf = (time: string | undefined) =>
  time && !time.startsWith('0001-') ? new Date(time).toISOString() : undefined

type Inspected = {
  Name: string
  State: { Running: boolean; StartedAt?: string; FinishedAt?: string }
  HostConfig: { Memory?: number; NanoCpus?: number; PidsLimit?: number }
}

/** Containers as `docker inspect` describes them. */
export const inspectContainers = async (names: string[]) =>
  names.length
    ? (JSON.parse(
        await docker('container', 'inspect', ...names),
      ) as Inspected[])
    : []

/** When a container last started, or while stopped, when it stopped. */
export const sinceOf = ({ State }: Inspected) =>
  timeOf(State.Running ? State.StartedAt : State.FinishedAt)

/**
 * What Docker can tell of a computer's container, all read at once: about
 * a second, as `docker stats` samples its CPU. A stopped one is only
 * inspected, which never starts it. Anything Docker can't answer is left out.
 */
export async function dockerDetail(
  name: string,
): Promise<Omit<ComputerDetail, 'status' | 'doing' | 'lastUsed'>> {
  const [container] = await inspectContainers([name])
  if (!container) {
    return {}
  }
  const limits = container.HostConfig
  const since = sinceOf(container)
  if (!container.State.Running) {
    return { since }
  }
  const optional = <T>(read: Promise<T>) => read.catch(() => undefined)
  const [stats, top, disk] = await Promise.all([
    optional(
      docker('stats', '--no-stream', '--format', '{{json .}}', name).then(
        (line) =>
          JSON.parse(line) as {
            CPUPerc: string
            MemUsage: string
            PIDs: string
          },
      ),
    ),
    optional(docker('top', name, '-eo', 'pid,rss,args')),
    optional(
      docker(
        'exec',
        name,
        'timeout',
        String(DISK_MAX_SECONDS),
        'du',
        '-sxb',
        HOME,
      ),
    ),
  ])
  const cpus = limits.NanoCpus ? limits.NanoCpus / 1e9 : undefined
  const memory = stats && bytesOf(stats.MemUsage.split('/')[0]!)
  const diskUsed = disk ? Number.parseInt(disk, 10) : Number.NaN
  return {
    since,
    ...(stats && {
      cpu: { used: Number.parseFloat(stats.CPUPerc) / 100, limit: cpus },
      processes: {
        used: Number(stats.PIDs),
        limit: limits.PidsLimit || undefined,
      },
    }),
    ...(memory !== undefined && {
      memory: { used: memory, limit: limits.Memory || undefined },
    }),
    ...(Number.isFinite(diskUsed) && { disk: { used: diskUsed } }),
    ...(top && { programs: programsOf(top) }),
  }
}

/**
 * `docker top`'s `pid,rss,args` rows as programs, the most memory first
 * (ps's CPU is an average over each process's life, not what it uses now).
 */
function programsOf(top: string) {
  return top
    .split('\n')
    .slice(1)
    .flatMap((row) => {
      const [, rss, command] = /^\s*\d+\s+(\d+)\s+(.+)$/.exec(row) ?? []
      return command
        ? [
            {
              command:
                command.length > COMMAND_MAX
                  ? `${command.slice(0, COMMAND_MAX - 1)}…`
                  : command,
              memory: Number(rss) * 1024,
            },
          ]
        : []
    })
    .sort((a, b) => b.memory - a.memory)
    .slice(0, PROGRAMS_MAX)
}

/**
 * What a computer's agent tells of it (what it's doing, its tabs and
 * system), only over a connection the host already has: a look never wakes
 * a computer, and the agent doesn't count it as use. An agent too old to
 * have the tool, or not answering, tells nothing.
 */
export async function agentInfo(
  client: Promise<Client> | undefined,
): Promise<ComputerInfo> {
  if (!client) {
    return {}
  }
  try {
    const result = (await (
      await client
    ).callTool(
      { name: INFO_TOOL, arguments: {} },
      { timeout: INFO_MAX_MS },
    )) as CallToolResult
    const [block] = result.content
    return !result.isError && block?.type === 'text'
      ? (JSON.parse(block.text) as ComputerInfo)
      : {}
  } catch {
    return {}
  }
}
