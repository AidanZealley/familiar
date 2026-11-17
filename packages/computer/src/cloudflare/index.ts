import { DurableObject } from 'cloudflare:workers'
import type { FamiliarId } from '@familiar-ai/core'
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import { AGENT_PORT_ENV } from '../agent/socket.ts'
import type { ComputerHost, ComputerStatus } from '../host.ts'

export type CloudflareContainersOptions = {
  /**
   * Names this workspace's computers apart from those of other workspaces
   * sharing the binding, such as its Durable Object's `ctx.id.toString()`.
   */
  workspace: string
  /** How long a computer runs without a call before it sleeps. Default 15 minutes. */
  idleMs?: number
}

/** The port the agent serves MCP on in the container. */
const AGENT_PORT = 8080
/** How long a computer that has just started has to open its port. */
const START_MAX_MS = 60_000
/** Longer than any tool's own limit: the agent stops its own calls first. */
const CALL_MAX_MS = 15 * 60_000

/**
 * MCP's revision in which each call is one HTTP request, so stopping a call
 * here drops its request, which the agent takes as stopping it. Earlier
 * revisions serve each request statelessly, where nothing stops a call
 * once it runs.
 */
const PER_REQUEST_MCP = '2026-07-28'

const WIPED =
  'Your computer was asleep, so it has just started afresh: files and programs from before are gone, and the browser has no pages open.'

const failed = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * A Familiar's computer: a Durable Object with a container, running this
 * package's image. Export it from the Worker and configure it in the
 * `wrangler` file as a container class, then give its binding to
 * `cloudflareContainers`. Cloudflare owns whether it runs: it stops the
 * container once no request has reached this object for the timeout `wake`
 * sets, and a stopped container's disk is gone.
 */
export class Computer extends DurableObject {
  get #container() {
    const container = this.ctx.container
    if (!container) {
      throw new Error(
        'Computer has no container: configure its class under `containers` in the wrangler file.',
      )
    }
    return container
  }

  /**
   * Starts the computer unless it's running, keeping it awake until `idleMs`
   * after the last request, and waits for its agent: whether it was asleep.
   */
  async wake(idleMs: number): Promise<boolean> {
    const container = this.#container
    const woke = !container.running
    if (woke) {
      container.start({
        env: { [AGENT_PORT_ENV]: `${AGENT_PORT}` },
        enableInternet: true,
      })
    }
    await container.setInactivityTimeout(idleMs)
    const port = container.getTcpPort(AGENT_PORT)
    const answers = async () => {
      try {
        await (await port.fetch('http://computer/')).body?.cancel()
        return true
      } catch {
        // Refused until the agent listens.
        return false
      }
    }
    const deadline = Date.now() + START_MAX_MS
    while (!(await answers())) {
      if (!container.running || Date.now() > deadline) {
        throw new Error("its agent didn't start.")
      }
      await new Promise((done) => setTimeout(done, 200))
    }
    return woke
  }

  /**
   * Passes a request to the agent's MCP server, and the caller dropping it
   * on, as the agent stops a call whose request drops. The drop reaches
   * this object given the Worker's `enable_request_signal` compatibility
   * flag (the default from 2026-11-17); `wrangler dev` doesn't carry it on
   * into the container.
   */
  override fetch(request: Request) {
    return this.#container
      .getTcpPort(AGENT_PORT)
      .fetch(request, { signal: request.signal })
  }

  /** Stops the computer, its disk with it. */
  async remove() {
    if (this.#container.running) {
      await this.#container.destroy()
    }
  }
}

/**
 * Familiars' computers as Cloudflare Containers, one `Computer` object each
 * in `binding`, named by the workspace and the Familiar. A computer starts
 * on its first call and sleeps after `idleMs` without one; a sleeping
 * computer has no disk, so each wake starts afresh and its call says so.
 *
 * The workspace reaches each computer's agent through its object: an MCP
 * client over Streamable HTTP, one per call, so nothing is kept between
 * calls and nothing is lost when either object is evicted.
 *
 * Who has a computer is known from the last `sync`; one removed before
 * this object last opened, but not yet stopped, sleeps on its own within
 * `idleMs`, and its disk goes with it.
 *
 * Any request to a computer's object keeps it awake, so `status` never asks
 * it: a computer runs while this host's calls to it are in flight and for
 * `idleMs` after the last ends, which is when Cloudflare stops it. After this
 * object is evicted, one still awake from before reads as asleep.
 */
export function cloudflareContainers(
  binding: DurableObjectNamespace<Computer>,
  options: CloudflareContainersOptions,
): ComputerHost {
  const idleMs = options.idleMs ?? 15 * 60_000
  const computerOf = (familiar: FamiliarId) =>
    binding.getByName(`${options.workspace}:familiar:${familiar}`)

  let wanted = new Set<FamiliarId>()
  /** Each computer this host has called: calls in flight, when the last ended. */
  const activity = new Map<FamiliarId, { calls: number; ended: number }>()
  /** Syncs, one at a time, so each removes from the set the last left. */
  let syncing: Promise<unknown> = Promise.resolve()

  return {
    call: async (familiar, tool, args, signal) => {
      const computer = computerOf(familiar)
      const active = activity.get(familiar) ?? { calls: 0, ended: 0 }
      activity.set(familiar, active)
      active.calls++
      try {
        return await callOn(computer, idleMs, tool, args, signal)
      } finally {
        active.calls--
        active.ended = Date.now()
      }
    },

    sync: (familiars) => {
      const run = syncing.then(async () => {
        const next = new Set(familiars)
        for (const familiar of wanted) {
          if (!next.has(familiar)) {
            await computerOf(familiar).remove()
            activity.delete(familiar)
          }
        }
        wanted = next
      })
      syncing = run.catch(() => {})
      return run
    },

    status: async (familiar): Promise<ComputerStatus> => {
      if (!wanted.has(familiar)) {
        return { state: 'none' }
      }
      const active = activity.get(familiar)
      const awake =
        !!active && (active.calls > 0 || Date.now() - active.ended < idleMs)
      return { state: awake ? 'running' : 'asleep' }
    },
  }
}

/** Runs `tool` on `computer`, waking it first to stay awake `idleMs`. */
async function callOn(
  computer: DurableObjectStub<Computer>,
  idleMs: number,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  let woke
  try {
    woke = await computer.wake(idleMs)
  } catch (error) {
    return failed(
      `Your computer couldn't start, so nothing ran: ${reasonOf(error)}`,
    )
  }
  const client = new Client(
    { name: 'familiar', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: PER_REQUEST_MCP } } },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://computer/'), {
      fetch: (url, init) => computer.fetch(new Request(url, init)),
    }),
  )
  try {
    const result = (await client.callTool(
      { name: tool, arguments: args },
      { signal, timeout: CALL_MAX_MS },
    )) as CallToolResult
    return woke
      ? {
          ...result,
          content: [{ type: 'text', text: WIPED }, ...result.content],
        }
      : result
  } finally {
    await client.close()
  }
}
