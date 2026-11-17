import { execFile } from 'node:child_process'
import { homedir, networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { FamiliarId } from '@familiar-ai/core'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AGENT_SOCKET, PROXY_PORT } from '../agent/socket.ts'
import type { ComputerHost, ComputerStatus } from '../host.ts'
import manifest from '../../package.json' with { type: 'json' }
import { OWN_ADDRESSES, PROXY_SOCKET } from './proxy.ts'

export type DockerHostOptions = {
  /**
   * In the name and labels of everything this host makes, so hosts sharing
   * a Docker engine leave each other's computers alone: give each its own.
   * Default `default`.
   */
  hostId?: string
  /** The computers' image, built from this package's Dockerfile. Default `COMPUTER_IMAGE`. */
  image?: string
  /** How long a computer runs without a call before it sleeps. Default 15 minutes. */
  idleMs?: number
  /**
   * How many computers this host may have, or a function read each time it
   * would make one, so a setting can change it without a restart. Lowering
   * it removes none; it only stops new ones. Default 10.
   */
  maxComputers?: number | (() => number)
}

/**
 * The computers' image, tagged with this package's version: each release
 * publishes its own, so a host runs the agent it was released with. A
 * checkout's version is `0.0.0`, the tag `pnpm image` builds.
 */
export const COMPUTER_IMAGE = `ghcr.io/aidanzealley/familiar-computer:${manifest.version}`

const exec = promisify(execFile)
/**
 * Where every Docker CLI process runs: the user's home, never inside an
 * install, data or temporary folder, which a process outliving the host
 * would keep from being deleted on Windows.
 */
const DOCKER_CWD = homedir()
/** Where a computer's home is: its disk, kept while it sleeps. */
const HOME = '/home/computer'
const HOST_LABEL = 'familiar-ai.host'
const FAMILIAR_LABEL = 'familiar-ai.familiar'
/** Longer than any tool's own limit: the agent stops its own calls first. */
const CALL_MAX_MS = 15 * 60_000
const RETRY_IMAGE_MS = 60_000

const WOKE =
  'Your computer was asleep, so it has just started: its files are as they were, but programs that were running have stopped.'

/** The kinds of Docker resource a computer host makes. */
type Kind = 'container' | 'volume'

/** A resource this host made: its Familiar's, unless shared; a container's state. */
type Owned = { kind: Kind; name: string; familiar?: FamiliarId; state?: string }

/**
 * This machine's addresses, which the proxy refuses even when they're
 * public. Read when the proxy is made, once per process; with `DOCKER_HOST`
 * on another machine, they are this one's, not the engine's.
 */
const ownAddresses = () =>
  Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? []).map(({ address }) => address),
  )

/** Runs the Docker CLI, which honours `DOCKER_HOST` (such as `ssh://…`) and Docker contexts. */
const docker = async (...args: string[]) =>
  (
    await exec('docker', args, {
      cwd: DOCKER_CWD,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim()

/** Why Docker couldn't do something, for the person or the model. */
function reasonOf(error: unknown) {
  const { code, stderr } = error as { code?: string; stderr?: string }
  if (code === 'ENOENT') {
    return 'Install Docker to give Familiars computers.'
  }
  return (
    stderr?.trim() || (error instanceof Error ? error.message : String(error))
  )
}

const failed = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

/**
 * Familiars' computers as Docker containers on this machine's engine (or
 * `DOCKER_HOST`'s), one each, through the `docker` CLI. Docker owns whether
 * each exists and runs: a sleeping computer is a stopped container, and its
 * disk is a volume. This process owns only whether the image is ready, the
 * idle timers and its open connections, and finds everything else by its
 * labels.
 *
 * The host reaches each computer's agent with `docker exec` and `socat`,
 * speaking MCP over the exec's stdio, so a computer needs no port and never
 * connects out to the host.
 *
 * Computers have no network (`--network none`). Their only way out is a
 * proxy container listening on a Unix socket in a volume every computer
 * mounts read-only, which each computer's agent passes its local proxy port
 * on to: public internet only, never the Docker host, its LAN, a tailnet or
 * another computer.
 */
export function dockerHost(options: DockerHostOptions = {}): ComputerHost {
  const hostId = options.hostId ?? 'default'
  const image = options.image ?? COMPUTER_IMAGE
  const idleMs = options.idleMs ?? 15 * 60_000
  const { maxComputers = 10 } = options
  const prefix = `familiar-${hostId}`
  const proxy = `${prefix}-proxy`
  /** The volume that holds the proxy's socket. */
  const proxyDir = `${prefix}-proxy-socket`
  /** A computer's container; its disk is named after it. */
  const container = (familiar: FamiliarId) => `${prefix}-${familiar}`
  const disk = (familiar: FamiliarId) => `${container(familiar)}-home`
  const ours = ['--label', `${HOST_LABEL}=${hostId}`]
  const theirs = (familiar: FamiliarId) => [
    ...ours,
    '--label',
    `${FAMILIAR_LABEL}=${familiar}`,
  ]

  /**
   * The image: fetched in the background from the start, unless it's here
   * already, and again each minute while that fails, such as before Docker
   * is installed.
   */
  let setup:
    | { state: 'setting-up'; done: Promise<void> }
    | { state: 'ready' }
    | { state: 'unavailable'; reason: string }
  const fetchImage = () => {
    const done = docker('image', 'inspect', image)
      .catch(() => docker('pull', image))
      .then(
        () => {
          setup = { state: 'ready' }
        },
        (error) => {
          setup = { state: 'unavailable', reason: reasonOf(error) }
          setTimeout(fetchImage, RETRY_IMAGE_MS).unref()
        },
      )
    setup = { state: 'setting-up', done }
  }
  fetchImage()

  /**
   * Changes to computers (making, waking, sleeping, removing), one at a
   * time, so `sync` and the idle timers never race each other or a wake.
   */
  let changing: Promise<unknown> = Promise.resolve()
  const change = <T>(task: () => Promise<T>) => {
    const run = changing.then(task)
    changing = run.catch(() => {})
    return run
  }

  /**
   * What this host has made of `kinds`, found only by its labels (and
   * `familiar`'s, if given), never by name, so nothing another host or
   * person made is used or removed. A computer's resources carry its
   * Familiar; the proxy and its socket's volume carry none.
   */
  const owned = async (
    kinds: readonly Kind[],
    familiar?: FamiliarId,
  ): Promise<Owned[]> =>
    (
      await Promise.all(
        kinds.map(async (kind) =>
          (
            await docker(
              kind,
              'ls',
              ...(kind === 'container' ? ['--all'] : []),
              '--filter',
              `label=${HOST_LABEL}=${hostId}`,
              ...(familiar === undefined
                ? []
                : ['--filter', `label=${FAMILIAR_LABEL}=${familiar}`]),
              '--format',
              kind === 'container'
                ? `{{.Names}}\t{{.Label "${FAMILIAR_LABEL}"}}\t{{.State}}`
                : `{{.Name}}\t{{.Label "${FAMILIAR_LABEL}"}}`,
            )
          )
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [name, familiar, state] = line.split('\t')
              return {
                kind,
                name: name!,
                ...(familiar && { familiar: Number(familiar) as FamiliarId }),
                ...(state && { state }),
              }
            }),
        ),
      )
    ).flat()

  /**
   * Makes the `kind` called `name` unless `have` (this host's) has it. One
   * by that name that isn't this host's fails instead of being used, as
   * Docker would quietly use a volume.
   */
  const ensure = async (
    kind: Kind,
    name: string,
    have: readonly Owned[],
    make: () => Promise<unknown>,
  ) => {
    if (have.some((owned) => owned.kind === kind && owned.name === name)) {
      return
    }
    if (
      await docker(kind, 'inspect', name).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error(
        `Docker already has a ${kind} called ${name} that this Familiar host didn't make, so it won't use or remove it. Rename or remove it, or give this host another hostId.`,
      )
    }
    await make()
  }

  /**
   * Removes `resources`, which `owned` found: containers first, then
   * volumes. Each step succeeds when what it removes is already gone.
   */
  const removeAll = async (resources: readonly Owned[]) => {
    const named = (kind: Kind) =>
      resources.filter((owned) => owned.kind === kind).map(({ name }) => name)
    for (const name of named('container')) {
      await docker('rm', '--force', name)
    }
    for (const name of named('volume')) {
      await docker('volume', 'rm', '--force', name)
    }
  }

  /**
   * The proxy and its socket's volume. Made again the first time this
   * process wakes or syncs a computer, even one that already exists, so the
   * proxy runs this host's image and knows its current addresses.
   */
  let prepared: Promise<void> | undefined
  const prepare = () =>
    (prepared ??= (async () => {
      const shared = (await owned(['container', 'volume'])).filter(
        (owned) => owned.familiar === undefined,
      )
      await ensure('volume', proxyDir, shared, () =>
        docker('volume', 'create', ...ours, proxyDir),
      )
      await removeAll(shared.filter((owned) => owned.kind === 'container'))
      await ensure('container', proxy, [], () =>
        docker(
          'run',
          '--detach',
          '--name',
          proxy,
          ...ours,
          '--restart',
          'unless-stopped',
          '--init',
          // Its way out is Docker's default network; it listens only on
          // its socket, so nothing there can use it.
          '--volume',
          `${proxyDir}:${dirname(PROXY_SOCKET)}`,
          '--env',
          `${OWN_ADDRESSES}=${ownAddresses().join(',')}`,
          '--entrypoint',
          'node',
          image,
          '/agent/dist/docker/proxy-main.js',
        ),
      )
    })().catch((error) => {
      prepared = undefined
      throw error
    }))

  /**
   * Why this host can't make another computer, if it has as many as
   * `maxComputers` allows, read now.
   */
  const full = async () => {
    const max =
      typeof maxComputers === 'function' ? maxComputers() : maxComputers
    const count = (await owned(['container'])).filter(
      (owned) => owned.familiar !== undefined,
    ).length
    return count >= max
      ? `This machine allows ${max} computer${max === 1 ? '' : 's'} at most, and Familiars have ${count}. Remove another Familiar's computer, or raise the limit.`
      : undefined
  }

  /**
   * Makes `familiar`'s container, on the disk it has (`have`), if any.
   * Fails with why if this host has as many computers as it may.
   */
  const create = async (familiar: FamiliarId, have: readonly Owned[]) => {
    const reason = await full()
    if (reason) {
      throw new Error(reason)
    }
    await ensure('volume', disk(familiar), have, () =>
      docker('volume', 'create', ...theirs(familiar), disk(familiar)),
    )
    const proxyUrl = `http://127.0.0.1:${PROXY_PORT}`
    await ensure('container', container(familiar), have, () =>
      docker(
        'create',
        '--name',
        container(familiar),
        '--hostname',
        `familiar-${familiar}`,
        ...theirs(familiar),
        '--network',
        'none',
        '--init',
        // So one Familiar can't starve the machine or the others.
        '--memory',
        '4g',
        '--cpus',
        '2',
        '--pids-limit',
        '512',
        // Chromium's shared memory; Docker's default 64 MB crashes big pages.
        '--shm-size',
        '1g',
        '--volume',
        `${disk(familiar)}:${HOME}`,
        '--volume',
        `${proxyDir}:${dirname(PROXY_SOCKET)}:ro`,
        ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(
          (name) => ['--env', `${name}=${proxyUrl}`],
        ),
        image,
        '--proxy-socket',
        PROXY_SOCKET,
      ),
    )
    return container(familiar)
  }

  /** Forgets `familiar`'s computer here and removes what `owned` found of it. */
  const remove = async (familiar: FamiliarId, resources: readonly Owned[]) => {
    clearTimeout(awake.get(familiar)?.timer)
    awake.delete(familiar)
    forget(familiar)
    await removeAll(resources)
  }

  /**
   * Starts `familiar`'s computer, making it first if it has none: its
   * container's name, and whether it was asleep.
   */
  const wake = (familiar: FamiliarId) =>
    change(async () => {
      await prepare()
      const have = await owned(['container', 'volume'], familiar)
      const found = have.find((owned) => owned.kind === 'container')
      const name = found?.name ?? (await create(familiar, have))
      if (found?.state === 'running') {
        return { name, woke: false }
      }
      await docker('start', name)
      return { name, woke: true }
    })

  /**
   * Each awake computer's calls in flight, and, once it has none, the timer
   * that puts it to sleep.
   */
  const awake = new Map<FamiliarId, { calls: number; timer?: NodeJS.Timeout }>()
  const begin = (familiar: FamiliarId) => {
    const activity = awake.get(familiar) ?? { calls: 0 }
    clearTimeout(activity.timer)
    activity.timer = undefined
    activity.calls++
    awake.set(familiar, activity)
  }
  const end = (familiar: FamiliarId) => {
    const activity = awake.get(familiar) ?? { calls: 1 }
    awake.set(familiar, activity)
    if (--activity.calls > 0) {
      return
    }
    const timer = setTimeout(
      () =>
        void change(async () => {
          // A call has come since.
          if (awake.get(familiar)?.timer !== timer) {
            return
          }
          awake.delete(familiar)
          forget(familiar)
          for (const { name } of await owned(['container'], familiar)) {
            await docker('stop', name)
          }
        }).catch(() => {}),
      idleMs,
    ).unref()
    activity.timer = timer
  }

  /**
   * Each computer's MCP client, over a `docker exec` into its agent's
   * socket, kept until the exec ends, as it does when the container stops.
   * `socat` retries for up to a minute while a computer that has just started
   * opens its socket.
   */
  const clients = new Map<FamiliarId, Promise<Client>>()
  const connect = (familiar: FamiliarId, name: string) => {
    const client = new Client({ name: 'familiar', version: '1.0.0' })
    const connected = client
      .connect(
        new StdioClientTransport({
          command: 'docker',
          args: [
            'exec',
            '--interactive',
            name,
            'socat',
            '-',
            `UNIX-CONNECT:${AGENT_SOCKET},retry=600,interval=0.1`,
          ],
          // The Docker CLI's own settings, such as DOCKER_HOST.
          env: process.env as Record<string, string>,
          cwd: DOCKER_CWD,
        }),
      )
      .then(() => client)
    const drop = () => {
      if (clients.get(familiar) === connected) {
        clients.delete(familiar)
      }
    }
    client.onclose = drop
    connected.catch(drop)
    clients.set(familiar, connected)
    return connected
  }
  const forget = (familiar: FamiliarId) => {
    void clients
      .get(familiar)
      ?.then((client) => client.close())
      .catch(() => {})
    clients.delete(familiar)
  }

  return {
    call: async (familiar, tool, args, signal) => {
      if (setup.state === 'setting-up') {
        return failed(
          'Your computer is still being set up: its software is downloading. Try again in a few minutes.',
        )
      }
      if (setup.state === 'unavailable') {
        return failed(`Computers aren't available here: ${setup.reason}`)
      }
      begin(familiar)
      try {
        let client = clients.get(familiar)
        let woke = false
        if (!client) {
          try {
            const started = await wake(familiar)
            woke = started.woke
            client = clients.get(familiar) ?? connect(familiar, started.name)
            await client
          } catch (error) {
            return failed(
              `Your computer couldn't start, so nothing ran: ${reasonOf(error)}`,
            )
          }
        }
        const result = (await (
          await client
        ).callTool(
          { name: tool, arguments: args },
          { signal, timeout: CALL_MAX_MS },
        )) as CallToolResult
        return woke
          ? {
              ...result,
              content: [{ type: 'text', text: WOKE }, ...result.content],
            }
          : result
      } finally {
        end(familiar)
      }
    },

    sync: (familiars) =>
      change(async () => {
        const wanted = new Set(familiars)
        const all = await owned(['container', 'volume'])
        const of = (familiar?: FamiliarId) =>
          all.filter((owned) => owned.familiar === familiar)
        for (const familiar of new Set(
          all.flatMap((owned) => owned.familiar ?? []),
        )) {
          if (!wanted.has(familiar)) {
            await remove(familiar, of(familiar))
          }
        }
        if (!wanted.size) {
          // Nothing left for the proxy to serve.
          prepared = undefined
          await removeAll(of(undefined))
          return
        }
        if (setup.state === 'setting-up') {
          await setup.done
        }
        await prepare()
        for (const familiar of wanted) {
          const found = of(familiar).find((owned) => owned.kind === 'container')
          if (!found) {
            // Past the limit, its status says why until there's room.
            if (await full()) {
              continue
            }
            await create(familiar, of(familiar))
          }
          // Left running by an earlier process, so sleeps when idle.
          if (found?.state === 'running' && !awake.has(familiar)) {
            begin(familiar)
            end(familiar)
          }
        }
      }).catch((error) => {
        throw new Error(reasonOf(error), { cause: error })
      }),

    status: async (familiar): Promise<ComputerStatus> => {
      let found: Owned | undefined
      let reason: string | undefined
      try {
        ;[found] = await owned(['container'], familiar)
        reason = found ? undefined : await full()
      } catch (error) {
        return { state: 'unavailable', reason: reasonOf(error) }
      }
      if (setup.state !== 'ready') {
        return setup.state === 'setting-up' ? { state: 'setting-up' } : setup
      }
      if (reason) {
        return { state: 'unavailable', reason }
      }
      return {
        state:
          found?.state === 'running' ? 'running' : found ? 'asleep' : 'none',
      }
    },
  }
}
