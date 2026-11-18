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
 * one pass at a time: it compares what's wanted with what Docker has and
 * puts it right. What's wanted is two values: `wanted`, the Familiars that
 * should have computers, which only `sync` sets, and `awake`, the computers
 * calls are waiting to run, which only `call` adds to. Nothing else makes,
 * starts, stops or removes anything, so no two changes ever cross.
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
   * The computers calls are waiting to run, each with whether a call asked
   * for it to be restarted. `wake` adds to it; the next pass takes it whole.
   */
  let awake = new Map<FamiliarId, boolean>()

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
   * Whether this process has made the proxy, so it runs this host's image
   * and knows this machine's addresses. Only a pass reads or sets it.
   */
  let proxyMade = false

  /**
   * One pass: what's wanted at its start, made true. It removes every other
   * Familiar's computer and disk (and with none wanted, the proxy), then
   * makes the proxy and each wanted computer that's missing, and runs each
   * computer a call is waiting on. Its `answers` say, for each of those,
   * whether it started it, or why it can't run; `failed`, what Docker
   * failed to do, if anything.
   */
  const pass = async () => {
    const want = wanted
    const waiting = awake
    awake = new Map()
    const ready = image.state.state === 'ready'
    const answers = new Map<FamiliarId, boolean | string>()
    let failed: unknown

    /**
     * Makes `familiar`'s computer if it's missing, and if a call is waiting
     * (`restart` is set), runs it, restarted if asked: whether it started
     * it, or why it can't run. One made from an earlier image, such as
     * before an update, is made again on the same disk as it wakes.
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
      // The proxy first, as making a computer would make its socket's
      // volume unlabelled.
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

  /**
   * The pass that will read what's wanted now: the next one, which starts
   * once the one running ends. Asked again before it starts, it's the same
   * pass, so any number of changes meanwhile make one more pass.
   */
  let settled: Promise<unknown> = Promise.resolve()
  let next: ReturnType<typeof pass> | undefined
  const reconcile = () =>
    (next ??= settled.then(() => {
      next = undefined
      const running = pass()
      settled = running
      return running
    }))

  /**
   * Asks for `familiar`'s computer to run, restarted if `restart`, and
   * waits for the pass that sees to it: whether it started it.
   */
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
   * Each awake computer's MCP connection, over a `docker exec` into its
   * agent's socket. An entry goes once it can't connect, before anyone
   * awaiting it hears why, or once its exec ends, before its `gone`
   * settles, as when the computer sleeps or is removed; and only then, so
   * only its own end ever removes it. While one is here, every call shares
   * it, so a computer is woken or restarted once for all of them.
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
  /** The agent's client for looking at `familiar`'s computer, if it's connected. */
  const looking = (familiar: FamiliarId) =>
    clients.get(familiar)?.then(({ client }) => client)

  /**
   * One try at running `tool` on `familiar`'s computer: its result, or why
   * it never reached the agent (it couldn't connect, or the agent was going
   * to sleep), which is safe to try again, restarting the computer. A call
   * that may have started isn't: its failure is thrown, as an action may
   * not be safe to repeat.
   */
  const attempt = async (
    familiar: FamiliarId,
    restart: boolean,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: CallToolResult; woke: boolean } | { retry: string }> => {
    const cached = clients.get(familiar)
    let connection
    try {
      connection = await (cached ?? open(familiar, restart))
    } catch (error) {
      return { retry: reasonOf(error) }
    }
    const { client, woke, gone } = connection
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
      // A try that never reached the agent is made once more, on a
      // restarted computer, unless another call has connected meanwhile.
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
      let { failed } = await reconcile()
      // Computers are made once their image is here.
      if (!failed && familiars.length && image.state.state !== 'ready') {
        await image.ready
        ;({ failed } = await reconcile())
      }
      if (failed) {
        throw new Error(reasonOf(failed), { cause: failed })
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
