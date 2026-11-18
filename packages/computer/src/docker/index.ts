import type { FamiliarId } from '@familiar-ai/core'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ComputerDetail, ComputerHost, ComputerStatus } from '../host.ts'
import { ASLEEP } from '../tools.ts'
import manifest from '../../package.json' with { type: 'json' }
import { computerImage } from './image.ts'
import {
  agentInfo,
  dockerDetail,
  inspectContainers,
  sinceOf,
} from './inspect.ts'
import {
  docker,
  DOCKER_CWD,
  dockerResources,
  reasonOf,
  type Owned,
} from './resources.ts'

export type DockerHostOptions = {
  /**
   * In the name and labels of everything this host makes, so hosts sharing
   * a Docker engine leave each other's computers alone: give each its own.
   * Default `default`.
   */
  hostId?: string
  /**
   * The repository of the computers' image, built from this package's
   * Dockerfile. Its other tags are removed once no container uses them, so
   * keep it for these images only. Default `COMPUTER_REPOSITORY`.
   */
  repository?: string
  /** The image's tag. Default this package's version. */
  tag?: string
  /**
   * How long a computer runs without a call before it sleeps, given to each
   * computer as it's made. Default 15 minutes.
   */
  idleMs?: number
  /**
   * How many computers this host may have, or a function read each time it
   * would make one, so a setting can change it without a restart. Lowering
   * it removes none; it only stops new ones. Default 10.
   */
  maxComputers?: number | (() => number)
}

/**
 * Where the computers' image is published, named once in this package's
 * `config.image`, which `pnpm image` and the release read too.
 */
export const COMPUTER_REPOSITORY = manifest.config.image

/**
 * The computers' image, tagged with this package's version: each release
 * publishes its own, so a host runs the agent it was released with. A
 * checkout's version is `0.0.0`, the tag `pnpm image` builds.
 */
export const COMPUTER_IMAGE = `${COMPUTER_REPOSITORY}:${manifest.version}`

/** Longer than any tool's own limit: the agent stops its own calls first. */
const CALL_MAX_MS = 15 * 60_000

const WOKE =
  'Your computer was asleep, so it has just started: its files are as they were, but programs that were running have stopped.'

const failed = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

/**
 * Familiars' computers as Docker containers on this machine's engine (or
 * `DOCKER_HOST`'s), one each, through the `docker` CLI. Docker owns whether
 * each exists and runs, and each computer's agent owns when it sleeps: it
 * ends itself after `idleMs` without a call, stopping its container, whose
 * disk is a volume (see `dockerResources`). This process keeps only its
 * connections to awake computers and the Familiars that should have one.
 *
 * It reconciles rather than coordinates: each change is an idempotent
 * Docker command, a wake makes a computer only for a Familiar that should
 * have one, and `sync` removes every other's. A wake and a removal that
 * cross are put right by the next `sync`.
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
  const {
    hostId = 'default',
    repository = COMPUTER_REPOSITORY,
    tag = manifest.version,
    idleMs = 15 * 60_000,
    maxComputers = 10,
  } = options
  const image = computerImage(repository, tag)
  const resources = dockerResources(hostId, {
    image: `${repository}:${tag}`,
    idleMs,
  })

  /** The Familiars that should have computers: the latest `sync`'s. */
  let wanted = new Set<FamiliarId>()

  /**
   * The proxy, made again the first time this process needs it, so it runs
   * this host's image and addresses, and again after `sync` removed it.
   */
  let proxy: Promise<void> | undefined
  const ensureProxy = () =>
    (proxy ??= resources.remakeProxy().catch((error) => {
      proxy = undefined
      throw error
    }))

  /** `maxComputers`, read now. */
  const maxNow = () =>
    typeof maxComputers === 'function' ? maxComputers() : maxComputers
  /** Why this host can't make another computer, if it's full. */
  const full = async () => {
    const max = maxNow()
    const count = (await resources.containers()).filter(
      (owned) => owned.familiar !== undefined,
    ).length
    return count >= max
      ? `This machine allows ${max} computer${max === 1 ? '' : 's'} at most, and Familiars have ${count}. Remove another Familiar's computer, or raise the limit.`
      : undefined
  }

  /**
   * Makes `familiar`'s computer, stopped, unless it has one; or says why it
   * can't. One at a time, so computers made together can't pass the limit.
   */
  let creating: Promise<unknown> = Promise.resolve()
  const create = (familiar: FamiliarId) => {
    const made = creating.then(async () => {
      if ((await resources.containers(familiar)).length) {
        return undefined
      }
      if (!wanted.has(familiar)) {
        return "This Familiar's computer is turned off."
      }
      return (await full()) ?? (await resources.createComputer(familiar))
    })
    creating = made.catch(() => {})
    return made
  }

  /**
   * Starts `familiar`'s computer unless it's running, making it first if it
   * has none, or made again on the same disk if it was made from an earlier
   * image, such as before an update. Whether it was asleep.
   */
  const start = async (familiar: FamiliarId) => {
    await ensureProxy()
    const [found] = await resources.containers(familiar)
    if (found?.running) {
      return false
    }
    const outdated = found && (await resources.outdated(familiar))
    if (outdated) {
      await docker('rm', found.name)
    }
    if (!found || outdated) {
      const reason = await create(familiar)
      if (reason) {
        throw new Error(reason)
      }
    }
    await docker('start', resources.container(familiar))
    if (outdated) {
      void image.removeOld()
    }
    return true
  }

  /**
   * Each awake computer's MCP client, over a `docker exec` into its agent's
   * socket. An entry goes once it can't connect, before anyone awaiting it
   * hears why, or once its exec ends, as when the computer sleeps or is
   * removed; and only then, so only its own end ever removes it.
   */
  const clients = new Map<FamiliarId, Promise<Client>>()
  /** `familiar`'s client, starting its computer first if needed, and whether that woke it. */
  const open = (familiar: FamiliarId) => {
    const cached = clients.get(familiar)
    if (cached) {
      return { client: cached, woke: Promise.resolve(false) }
    }
    const woke = start(familiar)
    const connection = woke.then(() => connect(familiar))
    const client = connection.then(
      ({ client }) => client,
      (error: unknown) => {
        clients.delete(familiar)
        throw error
      },
    )
    clients.set(familiar, client)
    void connection.then(
      ({ closed }) => closed.then(() => clients.delete(familiar)),
      () => {},
    )
    return { client, woke }
  }
  const connect = async (familiar: FamiliarId) => {
    const client = new Client({ name: 'familiar', version: '1.0.0' })
    const closed = new Promise<void>((resolve) => (client.onclose = resolve))
    try {
      await client.connect(
        new StdioClientTransport({
          command: 'docker',
          args: resources.agentCommand(familiar),
          // The Docker CLI's own settings, such as DOCKER_HOST.
          env: process.env as Record<string, string>,
          cwd: DOCKER_CWD,
        }),
      )
    } catch (error) {
      await client.close().catch(() => {})
      throw error
    }
    return { client, closed }
  }

  /**
   * One try at running `tool` on `familiar`'s computer: its result, or why
   * it never reached the agent (it couldn't connect, or the agent was going
   * to sleep), which is safe to try again. A call that may have started
   * isn't: its failure is thrown, as an action may not be safe to repeat.
   */
  const attempt = async (
    familiar: FamiliarId,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: CallToolResult; woke: boolean } | { retry: string }> => {
    const opened = open(familiar)
    const client = await opened.client.catch((error: unknown) =>
      reasonOf(error),
    )
    if (typeof client === 'string') {
      return { retry: client }
    }
    const result = (await client.callTool(
      { name: tool, arguments: args },
      { signal, timeout: CALL_MAX_MS },
    )) as CallToolResult
    if (result._meta?.[ASLEEP]) {
      await client.close()
      return { retry: 'it went to sleep as it woke' }
    }
    return { result, woke: await opened.woke }
  }

  const status = async (familiar: FamiliarId): Promise<ComputerStatus> => {
    const { state } = image
    if (state.state !== 'ready') {
      return state
    }
    try {
      const [found] = await resources.containers(familiar)
      if (found) {
        return { state: found.running ? 'running' : 'asleep' }
      }
      const reason = await full()
      return reason ? { state: 'unavailable', reason } : { state: 'none' }
    } catch (error) {
      return { state: 'unavailable', reason: reasonOf(error) }
    }
  }

  return {
    call: async (familiar, tool, args, signal) => {
      const { state } = image
      if (state.state === 'setting-up') {
        return failed(
          'Your computer is still being set up: its software is downloading. Try again in a few minutes.',
        )
      }
      if (state.state === 'unavailable') {
        return failed(`Computers aren't available here: ${state.reason}`)
      }
      // A first try that never reached the agent is tried once more, after
      // stopping the computer, so the second starts it afresh rather than
      // reaching an agent on its way out. Stopping is bounded, so it can't
      // hang on a computer that never sleeps itself.
      const first = await attempt(familiar, tool, args, signal)
      if ('retry' in first) {
        await docker(
          'stop',
          '--time',
          '5',
          resources.container(familiar),
        ).catch(() => {})
      }
      const answer =
        'retry' in first ? await attempt(familiar, tool, args, signal) : first
      if ('retry' in answer) {
        return failed(
          `Your computer couldn't start, so nothing ran: ${answer.retry}`,
        )
      }
      const { result, woke } = answer
      return woke
        ? {
            ...result,
            content: [{ type: 'text', text: WOKE }, ...result.content],
          }
        : result
    },

    sync: async (familiars) => {
      wanted = new Set(familiars)
      try {
        // Every other Familiar's computer and disk, and with none wanted,
        // the proxy: containers first, as volumes in use can't go. Each is
        // checked against `wanted` just before it goes, so a later `sync`
        // that wants it again, arriving meanwhile, wins.
        const unwanted = ({ familiar }: Owned) =>
          familiar === undefined ? !wanted.size : !wanted.has(familiar)
        for (const container of await resources.containers()) {
          if (unwanted(container)) {
            await docker('rm', '--force', container.name)
          }
        }
        for (const volume of await resources.volumes()) {
          if (unwanted(volume)) {
            await docker('volume', 'rm', '--force', volume.name)
          }
        }
        if (!wanted.size) {
          proxy = undefined
          return
        }
        // The proxy first, as making a computer would make its socket's
        // volume unlabelled. `create` makes only a computer that's missing
        // and still wanted; past the limit, its status says why.
        await image.ready
        await ensureProxy()
        for (const familiar of wanted) {
          await create(familiar)
        }
      } catch (error) {
        throw new Error(reasonOf(error), { cause: error })
      }
    },

    status,

    inspect: async (familiar) => {
      const current = await status(familiar)
      if (current.state !== 'running' && current.state !== 'asleep') {
        return { status: current }
      }
      const [detail, info] = await Promise.all([
        dockerDetail(resources.container(familiar)).catch(
          (): ComputerDetail => ({}),
        ),
        current.state === 'running' ? agentInfo(clients.get(familiar)) : {},
      ])
      return { status: current, ...detail, ...info }
    },

    summary: async () => {
      let owned, inspected
      try {
        owned = (await resources.containers()).filter(
          (container) => container.familiar !== undefined,
        )
        inspected = await inspectContainers(owned.map(({ name }) => name))
      } catch (error) {
        throw new Error(reasonOf(error), { cause: error })
      }
      return {
        max: maxNow(),
        computers: await Promise.all(
          owned.map(async ({ name, familiar, running }) => {
            const container = inspected.find(
              (found) => found.Name === `/${name}`,
            )
            const { doing, lastUsed } = running
              ? await agentInfo(clients.get(familiar!))
              : {}
            return {
              familiar: familiar!,
              state: running ? ('running' as const) : ('asleep' as const),
              since: container && sinceOf(container),
              doing,
              lastUsed,
            }
          }),
        ),
      }
    },
  }
}
