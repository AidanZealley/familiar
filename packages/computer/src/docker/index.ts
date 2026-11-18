import type { FamiliarId } from '@familiar-ai/core'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ComputerDetail, ComputerHost, ComputerStatus } from '../host.ts'
import { ASLEEP } from '../tools.ts'
import manifest from '../../package.json' with { type: 'json' }
import { coalesce } from './coalesce.ts'
import { computerImage } from './image.ts'
import {
  agentInfo,
  dockerDetail,
  inspectContainers,
  sinceOf,
} from './inspect.ts'
import {
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
 * `DOCKER_HOST`'s), one each, through the `docker` CLI. Each computer's
 * agent owns when it sleeps: it ends itself after `idleMs` without a call,
 * stopping its container, whose disk is a volume (see `dockerResources`).
 *
 * Everything else this host changes in Docker, one `reconcile` pass does,
 * one pass at a time, making what's wanted true. What's wanted is two
 * values: `wanted`, the Familiars that should have computers, which only
 * `sync` sets, and `awake`, the computers calls are waiting to run, which
 * only `call` adds to. Nothing else makes, starts, stops or removes
 * anything, so no two changes ever cross.
 *
 * The host reaches each agent over a `docker exec` into its socket, so a
 * computer needs no port. Computers have no network: their only way out is
 * a proxy container, public internet only (see `dockerResources`).
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

  let wanted = new Set<FamiliarId>()
  /** Each computer a call is waiting to run: whether to restart it. */
  let awake = new Map<FamiliarId, boolean>()

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

  /** Whether this process made the proxy, so it runs this host's image. */
  let proxyMade = false

  /**
   * Makes what's wanted at its start true. `answers`, for each computer a
   * call waits on: whether it started it, or why it can't run. `failed`:
   * what Docker failed to do, if anything.
   */
  const pass = async () => {
    const want = wanted
    const waiting = awake
    awake = new Map()
    const ready = image.state.state === 'ready'
    const answers = new Map<FamiliarId, boolean | string>()
    let failed: unknown

    /**
     * Makes `familiar`'s computer if it's missing and, if a call waits on it
     * (`restart` is set), runs it. One from an earlier image is made again,
     * on the same disk, as it wakes.
     */
    const converge = async (familiar: FamiliarId, restart?: boolean) => {
      if (!want.has(familiar)) {
        return "This Familiar's computer is turned off."
      }
      if (!ready) {
        return "This Familiar's computer is still being set up."
      }
      let found: Owned | undefined = (await resources.containers(familiar))[0]
      const outdated =
        restart !== undefined &&
        found &&
        !found.running &&
        (await resources.outdated(familiar))
      if (outdated) {
        await resources.remove('container', found.name)
        found = undefined
      }
      if (!found) {
        const reason = await full()
        if (reason) {
          return reason
        }
        await resources.createComputer(familiar)
      }
      if (restart === undefined || (found?.running && !restart)) {
        return false
      }
      if (found?.running) {
        await resources.stop(familiar)
      }
      await resources.start(familiar)
      if (outdated) {
        void image.removeOld()
      }
      return true
    }

    try {
      const unwanted = ({ familiar }: Owned) =>
        familiar === undefined ? !want.size : !want.has(familiar)
      const containers = await resources.containers()
      for (const container of containers.filter(unwanted)) {
        await resources.remove('container', container.name)
      }
      for (const volume of (await resources.volumes()).filter(unwanted)) {
        await resources.remove('volume', volume.name)
      }
      // Before any computer, which would make the socket volume unlabelled.
      const hasProxy = containers.some(({ familiar }) => familiar === undefined)
      if (ready && want.size && !(proxyMade && hasProxy)) {
        await resources.remakeProxy()
        proxyMade = true
      }
      for (const familiar of new Set([...want, ...waiting.keys()])) {
        const answer = await converge(familiar, waiting.get(familiar)).catch(
          (error: unknown) => {
            failed ??= error
            return reasonOf(error)
          },
        )
        answers.set(familiar, answer)
      }
    } catch (error) {
      failed = error
      for (const familiar of waiting.keys()) {
        answers.set(familiar, reasonOf(error))
      }
    }
    return { answers, failed }
  }

  /** The pass that will read what's wanted now. */
  const reconcile = coalesce(pass)
  const checkedPass = async () => {
    const { failed } = await reconcile()
    if (failed) {
      throw new Error(reasonOf(failed), { cause: failed })
    }
  }

  /** Waits for the pass that runs the computer: whether it started it. */
  const wake = async (familiar: FamiliarId, restart: boolean) => {
    awake.set(familiar, restart || (awake.get(familiar) ?? false))
    const answer = (await reconcile()).answers.get(familiar)!
    if (typeof answer === 'string') {
      throw new Error(answer)
    }
    return answer
  }

  type Connection = { client: Client; woke: boolean; gone: Promise<void> }
  /**
   * Each awake computer's connection, shared by every call so a computer is
   * woken or restarted once for all of them. Only an entry's own end
   * removes it: failing to connect, before its awaiters hear why, or its
   * exec ending, before its `gone` settles.
   */
  const clients = new Map<FamiliarId, Promise<Connection>>()
  const open = (familiar: FamiliarId, restart: boolean) => {
    const connection = wake(familiar, restart).then(async (woke) => {
      const { client, closed } = await connect(familiar)
      return {
        client,
        woke,
        gone: closed.then(() => void clients.delete(familiar)),
      }
    })
    const entry = connection.catch((error: unknown) => {
      clients.delete(familiar)
      throw error
    })
    clients.set(familiar, entry)
    return entry
  }
  const connect = async (familiar: FamiliarId) => {
    const client = new Client({ name: 'familiar', version: '1.0.0' })
    const closed = new Promise<void>((resolve) => (client.onclose = resolve))
    try {
      await client.connect(
        new StdioClientTransport({
          command: 'docker',
          args: resources.agentCommand(familiar),
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
  /** The client for looking at `familiar`'s computer, if it's connected. */
  const looking = (familiar: FamiliarId) =>
    clients.get(familiar)?.then(({ client }) => client)

  /**
   * One try at running `tool`: its result, or `retry` when it never reached
   * the agent (it couldn't connect, or the agent was going to sleep). A
   * call that may have started is never retried: its failure is thrown, as
   * an action may not be safe to repeat.
   */
  const attempt = async (
    familiar: FamiliarId,
    restart: boolean,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: CallToolResult; woke: boolean } | { retry: string }> => {
    const cached = clients.get(familiar)
    const connected = await (cached ?? open(familiar, restart)).then(
      (connection) => ({ connection }),
      (error: unknown) => ({ retry: reasonOf(error) }),
    )
    if ('retry' in connected) {
      return connected
    }
    const { client, woke, gone } = connected.connection
    const result = (await client.callTool(
      { name: tool, arguments: args },
      { signal, timeout: CALL_MAX_MS },
    )) as CallToolResult
    if (result._meta?.[ASLEEP]) {
      void client.close()
      await gone
      return { retry: 'it went to sleep as it woke' }
    }
    return { result, woke: !cached && woke }
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
      // Once more on a restarted computer, unless another call connected.
      const first = await attempt(familiar, false, tool, args, signal)
      const answer =
        'retry' in first
          ? await attempt(familiar, true, tool, args, signal)
          : first
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
      await checkedPass()
      // Computers are made once their image is here.
      if (familiars.length && image.state.state !== 'ready') {
        await image.ready
        await checkedPass()
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
        current.state === 'running' ? agentInfo(looking(familiar)) : {},
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
              ? await agentInfo(looking(familiar!))
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
