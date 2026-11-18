import type { FamiliarId } from '@familiar-ai/core'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ComputerHost, ComputerStatus } from '../host.ts'
import manifest from '../../package.json' with { type: 'json' }
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
const RETRY_IMAGE_MS = 60_000

const WOKE =
  'Your computer was asleep, so it has just started: its files are as they were, but programs that were running have stopped.'

const failed = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

/** A computer this process is using. */
type Session = {
  /**
   * Its MCP client, over a `docker exec` into its agent's socket, kept until
   * the exec ends, as it does when the container stops.
   */
  client?: Promise<Client>
  /** Calls in flight; it sleeps only once there are none. */
  calls: number
  /** Once it has no calls, what puts it to sleep. */
  timer?: NodeJS.Timeout
}

/**
 * Familiars' computers as Docker containers on this machine's engine (or
 * `DOCKER_HOST`'s), one each, through the `docker` CLI. Docker owns whether
 * each exists and runs: a sleeping computer is a stopped container, and its
 * disk is a volume (see `dockerResources`). This process owns only whether
 * the image is ready and the computers it's using: their connections and
 * when they sleep.
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
  const image = `${repository}:${tag}`
  const resources = dockerResources(hostId, { repository, tag })

  /**
   * The image: fetched in the background from the start, unless it's here
   * already, and again each minute while that fails, such as before Docker
   * is installed. Once it's here, its other versions that no container
   * uses are removed, so the machine keeps one.
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
          void resources.removeOldImages().catch(() => {})
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
   * The proxy, made again the first time this process wakes or syncs a
   * computer, even one that already exists, then kept until no Familiar
   * has a computer.
   */
  let proxyMade: Promise<void> | undefined
  const makeProxy = () =>
    (proxyMade ??= resources.remakeProxy().catch((error) => {
      proxyMade = undefined
      throw error
    }))

  /** Why this host can't make another computer, if `maxComputers`, read now, says it's full. */
  const full = async () => {
    const max =
      typeof maxComputers === 'function' ? maxComputers() : maxComputers
    const count = (await resources.containers()).filter(
      (owned) => owned.familiar !== undefined,
    ).length
    return count >= max
      ? `This machine allows ${max} computer${max === 1 ? '' : 's'} at most, and Familiars have ${count}. Remove another Familiar's computer, or raise the limit.`
      : undefined
  }

  const sessions = new Map<FamiliarId, Session>()
  const sessionOf = (familiar: FamiliarId) =>
    sessions.get(familiar) ??
    sessions.set(familiar, { calls: 0 }).get(familiar)!
  /** Forgets `familiar`'s session, closing its client. */
  const drop = (familiar: FamiliarId) => {
    const session = sessions.get(familiar)
    sessions.delete(familiar)
    clearTimeout(session?.timer)
    void session?.client?.then((client) => client.close()).catch(() => {})
  }
  /** Puts `familiar`'s computer to sleep after `idleMs` unless a call comes. */
  const idle = (familiar: FamiliarId, session: Session) => {
    const timer = setTimeout(
      () =>
        void change(async () => {
          // A call has come since, or `sync` removed it.
          if (session.timer !== timer || sessions.get(familiar) !== session) {
            return
          }
          drop(familiar)
          await docker('stop', resources.container(familiar))
        }).catch(() => {}),
      idleMs,
    ).unref()
    session.timer = timer
  }
  /**
   * Starts `familiar`'s computer, making it first if it has none and this
   * host has room, and connects `session` to it: its client, and whether it
   * was asleep. One change, so `sync` can't remove the computer meanwhile.
   */
  const wake = (familiar: FamiliarId, session: Session) =>
    change(async () => {
      if (sessions.get(familiar) !== session) {
        throw new Error('it was removed')
      }
      if (session.client) {
        return { client: session.client, woke: false }
      }
      await makeProxy()
      const [found] = await resources.containers(familiar)
      if (!found) {
        const reason = await full()
        if (reason) {
          throw new Error(reason)
        }
        await resources.createComputer(familiar)
      }
      // Made from an earlier image, such as before an update: made again
      // on this one, on the same disk.
      if (found && !found.running && (await resources.outdated(familiar))) {
        await docker('rm', found.name)
        await resources.createComputer(familiar)
        void resources.removeOldImages().catch(() => {})
      }
      if (!found?.running) {
        await docker('start', resources.container(familiar))
      }
      session.client = connect(familiar, session)
      return { client: session.client, woke: !found?.running }
    })
  /** Connects `session`'s client, which it forgets once the exec ends. */
  const connect = (familiar: FamiliarId, session: Session) => {
    const client = new Client({ name: 'familiar', version: '1.0.0' })
    const connected = client
      .connect(
        new StdioClientTransport({
          command: 'docker',
          args: resources.agentCommand(familiar),
          // The Docker CLI's own settings, such as DOCKER_HOST.
          env: process.env as Record<string, string>,
          cwd: DOCKER_CWD,
        }),
      )
      .then(() => client)
    const lost = () => {
      if (session.client === connected) {
        session.client = undefined
      }
    }
    client.onclose = lost
    connected.catch(lost)
    return connected
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
      const session = sessionOf(familiar)
      clearTimeout(session.timer)
      session.timer = undefined
      session.calls++
      try {
        let woke = false
        let client
        try {
          const started = session.client
            ? { client: session.client, woke: false }
            : await wake(familiar, session)
          woke = started.woke
          client = await started.client
        } catch (error) {
          return failed(
            `Your computer couldn't start, so nothing ran: ${reasonOf(error)}`,
          )
        }
        const result = (await client.callTool(
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
        // Unless `sync` removed it meanwhile.
        if (--session.calls === 0 && sessions.get(familiar) === session) {
          idle(familiar, session)
        }
      }
    },

    sync: (familiars) =>
      change(async () => {
        const wanted = new Set(familiars)
        for (const familiar of sessions.keys()) {
          if (!wanted.has(familiar)) {
            drop(familiar)
          }
        }
        // Every other Familiar's computer and disk, and with none wanted,
        // the proxy: containers first, as volumes in use can't go.
        const unwanted = ({ familiar }: Owned) =>
          familiar === undefined ? !wanted.size : !wanted.has(familiar)
        const have = await resources.containers()
        for (const { name } of have.filter(unwanted)) {
          await docker('rm', '--force', name)
        }
        for (const { name } of (await resources.volumes()).filter(unwanted)) {
          await docker('volume', 'rm', '--force', name)
        }
        if (!wanted.size) {
          proxyMade = undefined
          return
        }
        if (setup.state === 'setting-up') {
          await setup.done
        }
        await makeProxy()
        for (const familiar of wanted) {
          const found = have.find((owned) => owned.familiar === familiar)
          // Past the limit, its status says why until there's room.
          if (!found && !(await full())) {
            await resources.createComputer(familiar)
          }
          // Left running by an earlier process, so sleeps when idle.
          if (found?.running && !sessions.has(familiar)) {
            idle(familiar, sessionOf(familiar))
          }
        }
      }).catch((error) => {
        throw new Error(reasonOf(error), { cause: error })
      }),

    status: async (familiar): Promise<ComputerStatus> => {
      if (setup.state !== 'ready') {
        return setup.state === 'setting-up' ? { state: 'setting-up' } : setup
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
    },
  }
}
