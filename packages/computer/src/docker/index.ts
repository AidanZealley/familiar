import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import type { FamiliarId } from '@familiar-ai/core'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AGENT_SOCKET } from '../agent/socket.ts'
import type { ComputerHost, ComputerStatus } from '../host.ts'
import { OWN_ADDRESSES, PROXY_PORT } from './proxy.ts'

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
}

/**
 * The computers' image, which `pnpm image` builds from a checkout. Until
 * releases publish it, its tag is `dev`, so a checkout's host finds the one
 * it built.
 */
export const COMPUTER_IMAGE = 'ghcr.io/aidanzealley/familiar-computer:dev'

const exec = promisify(execFile)
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
type Kind = 'container' | 'volume' | 'network'

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
  (await exec('docker', args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

/** Why Docker couldn't do something, for the person or the model. */
function reasonOf(error: unknown) {
  const { code, stderr } = error as { code?: string; stderr?: string }
  if (code === 'ENOENT') {
    return "Docker isn't installed."
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
 * Each computer has an internal network of its own whose only way out is a
 * proxy container joined to every computer's network: public internet only,
 * never the Docker host, its LAN or a tailnet. The networks' gateways are
 * isolated, so a computer can't reach the Docker host around the proxy, nor
 * other computers. Docker's default address pools fit about 28 such
 * networks per engine; `default-address-pools` in its `daemon.json` raises
 * that.
 */
export function dockerHost(options: DockerHostOptions = {}): ComputerHost {
  const hostId = options.hostId ?? 'default'
  const image = options.image ?? COMPUTER_IMAGE
  const idleMs = options.idleMs ?? 15 * 60_000
  const prefix = `familiar-${hostId}`
  const outside = `${prefix}-outside`
  const proxy = `${prefix}-proxy`
  /** A computer's container; its disk and network are named after it. */
  const container = (familiar: FamiliarId) => `${prefix}-${familiar}`
  const disk = (familiar: FamiliarId) => `${container(familiar)}-home`
  const network = (familiar: FamiliarId) => `${container(familiar)}-network`
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
   * Familiar; the proxy and its network carry none.
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
   * networks, each disconnected from `proxies` first, then volumes. Each
   * step succeeds when what it removes is already gone.
   */
  const removeAll = async (
    resources: readonly Owned[],
    proxies: readonly Owned[] = [],
  ) => {
    const named = (kind: Kind) =>
      resources.filter((owned) => owned.kind === kind).map(({ name }) => name)
    for (const name of named('container')) {
      await docker('rm', '--force', name)
    }
    for (const name of named('network')) {
      for (const proxy of proxies) {
        await docker('network', 'disconnect', '--force', name, proxy.name)
          // Not connected, or either is gone.
          .catch(() => {})
      }
      await docker('network', 'rm', '--force', name)
    }
    for (const name of named('volume')) {
      await docker('volume', 'rm', '--force', name)
    }
  }

  /**
   * The proxy's way out and the proxy, joined to every computer's network.
   * Made again the first time this process needs it, so the proxy runs this
   * host's image and knows its current addresses.
   */
  let prepared: Promise<void> | undefined
  const prepare = () =>
    (prepared ??= (async () => {
      const all = await owned(['container', 'network'])
      const shared = all.filter((owned) => owned.familiar === undefined)
      await ensure('network', outside, shared, () =>
        docker('network', 'create', ...ours, outside),
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
          // Its route out, then each computer's network.
          '--network',
          outside,
          ...all
            .filter((owned) => owned.kind === 'network' && owned.familiar)
            .flatMap(({ name }) => ['--network', name]),
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

  /** Makes `familiar`'s container, on the disk and network it has (`have`), if any. */
  const create = async (familiar: FamiliarId, have: readonly Owned[]) => {
    await prepare()
    const name = network(familiar)
    await ensure('volume', disk(familiar), have, () =>
      docker('volume', 'create', ...theirs(familiar), disk(familiar)),
    )
    await ensure('network', name, have, () =>
      docker(
        'network',
        'create',
        '--internal',
        // No address on the Docker host, so the proxy is the only way out.
        '--opt',
        'com.docker.network.bridge.gateway_mode_ipv4=isolated',
        '--opt',
        'com.docker.network.bridge.gateway_mode_ipv6=isolated',
        ...theirs(familiar),
        name,
      ),
    )
    // Checked apart from making the network, in case joining failed before.
    const joined = await docker(
      'inspect',
      '--format',
      '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}',
      proxy,
    )
    if (!joined.split(' ').includes(name)) {
      await docker('network', 'connect', name, proxy)
    }
    const proxyUrl = `http://${proxy}:${PROXY_PORT}`
    await ensure('container', container(familiar), have, () =>
      docker(
        'create',
        '--name',
        container(familiar),
        '--hostname',
        `familiar-${familiar}`,
        ...theirs(familiar),
        '--network',
        name,
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
        ...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(
          (name) => ['--env', `${name}=${proxyUrl}`],
        ),
        image,
      ),
    )
    return container(familiar)
  }

  /** Forgets `familiar`'s computer here and removes what `owned` found of it. */
  const remove = async (
    familiar: FamiliarId,
    resources: readonly Owned[],
    proxies: readonly Owned[],
  ) => {
    clearTimeout(awake.get(familiar)?.timer)
    awake.delete(familiar)
    forget(familiar)
    await removeAll(resources, proxies)
  }

  /**
   * Starts `familiar`'s computer, making it first if it has none: its
   * container's name, and whether it was asleep.
   */
  const wake = (familiar: FamiliarId) =>
    change(async () => {
      const have = await owned(['container', 'volume', 'network'], familiar)
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
        const all = await owned(['container', 'volume', 'network'])
        const of = (familiar?: FamiliarId) =>
          all.filter((owned) => owned.familiar === familiar)
        const shared = of(undefined)
        const proxies = shared.filter((owned) => owned.kind === 'container')
        for (const familiar of new Set(
          all.flatMap((owned) => owned.familiar ?? []),
        )) {
          if (!wanted.has(familiar)) {
            await remove(familiar, of(familiar), proxies)
          }
        }
        if (!wanted.size) {
          // Nothing left for the proxy to serve.
          prepared = undefined
          await removeAll(shared)
          return
        }
        if (setup.state === 'setting-up') {
          await setup.done
        }
        for (const familiar of wanted) {
          const found = of(familiar).find((owned) => owned.kind === 'container')
          if (!found) {
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
      try {
        ;[found] = await owned(['container'], familiar)
      } catch (error) {
        return { state: 'unavailable', reason: reasonOf(error) }
      }
      if (setup.state !== 'ready') {
        return setup.state === 'setting-up' ? { state: 'setting-up' } : setup
      }
      return {
        state:
          found?.state === 'running' ? 'running' : found ? 'asleep' : 'none',
      }
    },
  }
}
