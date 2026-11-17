import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import type { FamiliarId, Workspace } from '@familiar-ai/core'
import { encryptedJsonFile } from '@familiar-ai/core/node'
import { Client, type Transport } from '@modelcontextprotocol/client'

/**
 * Each Familiar's computer, by FamiliarId: its pairing token, and whether
 * the provider runs it rather than a machine paired by hand.
 */
type Saved = Record<string, { token: string; provided?: true }>

export type ComputerStatus = 'none' | 'asleep' | 'offline' | 'online'

/**
 * A provider's computer: running, stopped (asleep), or only its remains,
 * such as its disk, left after it was deleted or half made.
 */
export type ProvidedComputer = 'running' | 'stopped' | 'remains'

/**
 * Something that runs computers for the host, such as Docker
 * (`@familiar-ai/computer/docker`). It alone knows whether each is running.
 * A computer it runs connects to the host with its pairing token, as any
 * paired machine does.
 */
export type ComputerProvider = {
  /** The Familiars it has anything for, and what. */
  list(): Promise<Map<FamiliarId, ProvidedComputer>>
  /** Makes `familiar`'s computer, stopped, unless it has one, on any disk that remains. */
  create(familiar: FamiliarId, token: string): Promise<void>
  /** Starts `familiar`'s computer, making it first if it's missing. */
  wake(familiar: FamiliarId, token: string): Promise<void>
  /** Stops it, keeping its disk. */
  sleep(familiar: FamiliarId): Promise<void>
  /** Deletes whatever it has for `familiar`, its disk too. */
  remove(familiar: FamiliarId): Promise<void>
}

export type ComputersOptions = {
  /** The encrypted file computers are kept in. */
  path: string
  /** The host's vault key, shared with its other encrypted files. */
  keyPath: string
  /**
   * How long a call waits for a computer that isn't connected, such as one
   * reconnecting after the host restarted, before saying it's offline.
   * Default 10 seconds; a provider's computer waking gets a minute.
   */
  waitMs?: number
  /** Runs computers the host gives Familiars, besides paired machines. */
  provider?: ComputerProvider
  /** How long a provider's computer sits unused before it sleeps. Default 15 minutes. */
  idleMs?: number
  /** Where failures nobody awaits are reported. Default `console.error`. */
  log?: (message: string) => void
}

const hash = (token: string) => createHash('sha256').update(token).digest()
const newToken = () => randomBytes(32).toString('base64url')
const WAKE_MS = 60_000
/** How often the check runs, besides at start and when Familiars change. */
const CHECK_EVERY_MS = 10 * 60_000

/**
 * The one owner of which Familiars have a computer and how each pairs,
 * saved under the host's key, of the computers connected now, and of the
 * calls each is serving. A computer is whatever runs the agent with its
 * pairing token: it connects in, and the host is the MCP client of the
 * agent's server. A provider's computer sleeps once no call has used it
 * for `idleMs`, and wakes for the next.
 */
export function openComputers(options: ComputersOptions) {
  const file = encryptedJsonFile<Saved>(
    options.path,
    options.keyPath,
    'computers',
    () => ({}),
  )
  const { provider } = options
  const log = options.log ?? console.error
  const online = new Map<FamiliarId, Client>()
  const arrivals = new EventEmitter()
  const waitMs = options.waitMs ?? 10_000
  const idleMs = options.idleMs ?? 15 * 60_000
  /** Calls under way on each computer. */
  const calls = new Map<FamiliarId, number>()
  /** Each idle provider computer's timer to sleep. */
  const idle = new Map<FamiliarId, NodeJS.Timeout>()
  /** Each Familiar's last lifecycle operation, which the next waits for. */
  const lifecycles = new Map<FamiliarId, Promise<unknown>>()

  /**
   * Runs `operation` once `familiar`'s earlier ones have finished, so
   * pairing, giving, removing, waking, sleeping and the check never overlap
   * on one computer. Each reads the saved state as it starts.
   */
  const serially = <T>(familiar: FamiliarId, operation: () => Promise<T>) => {
    const result = (lifecycles.get(familiar) ?? Promise.resolve()).then(
      operation,
    )
    const settled = result.catch(() => {})
    lifecycles.set(familiar, settled)
    void settled.then(() => {
      if (lifecycles.get(familiar) === settled) {
        lifecycles.delete(familiar)
      }
    })
    return result
  }

  const disconnect = async (familiar: FamiliarId) => {
    const client = online.get(familiar)
    online.delete(familiar)
    await client?.close()
  }

  const save = (change: (saved: Saved) => void) => {
    const next = { ...file.value }
    change(next)
    file.save(next)
  }

  /** Puts `familiar`'s computer to sleep once it's been idle `idleMs`. */
  const sleepWhenIdle = (familiar: FamiliarId) => {
    clearTimeout(idle.get(familiar))
    idle.set(
      familiar,
      setTimeout(() => {
        idle.delete(familiar)
        serially(familiar, async () => {
          // A call may have started, or the computer gone, meanwhile.
          if (calls.get(familiar) || !file.value[familiar]?.provided) {
            return
          }
          await disconnect(familiar)
          await provider!.sleep(familiar)
        }).catch((error) => log(`Couldn't put a computer to sleep: ${error}`))
      }, idleMs).unref(),
    )
  }

  /** Waits up to `ms` for `familiar`'s computer to connect. */
  const arrival = async (
    familiar: FamiliarId,
    ms: number,
    signal?: AbortSignal,
  ) => {
    if (!online.has(familiar)) {
      await once(arrivals, String(familiar), {
        signal: AbortSignal.any([
          AbortSignal.timeout(ms),
          ...(signal ? [signal] : []),
        ]),
      }).catch(() => {})
    }
    return online.get(familiar)
  }

  /**
   * Within `serially`: deletes the provider's computer, then forgets
   * `familiar`'s. If deleting fails, the computer is kept, so it's never
   * given a new token while the old container remains; the caller sees the
   * error and the check tries again.
   */
  const removeComputer = async (familiar: FamiliarId) => {
    const saved = file.value[familiar]
    if (!saved) {
      return
    }
    clearTimeout(idle.get(familiar))
    idle.delete(familiar)
    await disconnect(familiar)
    if (saved.provided) {
      // Without a provider now, its check sweeps the container up later.
      await provider?.remove(familiar)
    }
    save((all) => delete all[familiar])
  }

  /**
   * Makes the provider's computers match: deletes a computer whose Familiar
   * or computer is gone, or what remains of one, makes a missing one again
   * (on its disk, if that survived), and puts a running one nobody uses to
   * sleep, as after the host restarted. `existing` may be stale by the time
   * a Familiar's turn comes, which every step allows for.
   */
  const check = async (familiars: Set<FamiliarId>) => {
    const existing = (await provider?.list()) ?? new Map()
    const ids = new Set<FamiliarId>([
      ...Object.keys(file.value).map((id) => Number(id) as FamiliarId),
      ...existing.keys(),
    ])
    for (const familiar of ids) {
      // One computer failing doesn't stop the check of the others.
      await serially(familiar, async () => {
        if (!familiars.has(familiar) && file.value[familiar]) {
          return removeComputer(familiar)
        }
        if (!provider) {
          return
        }
        const saved = file.value[familiar]
        const found = existing.get(familiar)
        if (!saved?.provided) {
          if (found) {
            await provider.remove(familiar)
          }
        } else if (found === 'running') {
          if (!calls.get(familiar) && !idle.has(familiar)) {
            sleepWhenIdle(familiar)
          }
        } else if (found !== 'stopped') {
          await provider.create(familiar, saved.token)
        }
      }).catch((error) =>
        log(`Couldn't check computer for Familiar ${familiar}: ${error}`),
      )
    }
  }

  return {
    /** Whether the host can give Familiars computers it runs. */
    provides: provider !== undefined,

    status: async (familiar: FamiliarId): Promise<ComputerStatus> => {
      const saved = file.value[familiar]
      if (!saved) {
        return 'none'
      }
      if (online.has(familiar)) {
        return 'online'
      }
      const found = saved.provided && (await provider?.list())?.get(familiar)
      return found && found !== 'running' ? 'asleep' : 'offline'
    },

    /** Whether `familiar`'s computer is one the provider runs, not a paired machine. */
    isProvided: (familiar: FamiliarId) =>
      file.value[familiar]?.provided === true,

    /**
     * Gives `familiar` a machine to pair, or pairs its machine afresh,
     * returning the new pairing token. A machine paired with an earlier
     * token is disconnected and can't connect again; a computer the
     * provider ran is removed with its disk.
     */
    pair: (familiar: FamiliarId) =>
      serially(familiar, async () => {
        await removeComputer(familiar)
        const token = newToken()
        save((all) => (all[familiar] = { token }))
        return token
      }),

    /**
     * Gives `familiar` a computer the provider runs, asleep until a call
     * needs it, unless it has one. A machine paired before is unpaired.
     */
    provide: (familiar: FamiliarId) =>
      serially(familiar, async () => {
        if (!provider) {
          throw new Error('This host has no computer provider.')
        }
        if (file.value[familiar]?.provided) {
          return
        }
        await removeComputer(familiar)
        const token = newToken()
        save((all) => (all[familiar] = { token, provided: true }))
        await provider.create(familiar, token)
      }),

    /**
     * Removes `familiar`'s computer: unpairs a machine, or deletes the
     * provider's computer with its disk.
     */
    remove: (familiar: FamiliarId) =>
      serially(familiar, () => removeComputer(familiar)),

    /** The Familiar whose computer `token` pairs, if any. */
    familiarFor: (token: string) => {
      const given = hash(token)
      const found = Object.entries(file.value).find(([, saved]) =>
        timingSafeEqual(hash(saved.token), given),
      )
      return found && (Number(found[0]) as FamiliarId)
    },

    /**
     * Uses the agent at the other end of `transport`, which connected with
     * `token`, as `familiar`'s computer in place of any connected before.
     */
    connect: async (
      familiar: FamiliarId,
      token: string,
      transport: Transport,
    ) => {
      const client = new Client({ name: 'familiar', version: '1.0.0' })
      await client.connect(transport, { timeout: 15_000 })
      // The computer may have been paired afresh while this one connected.
      if (file.value[familiar]?.token !== token) {
        await client.close()
        throw new Error('This pairing token has been replaced.')
      }
      const previous = online.get(familiar)
      online.set(familiar, client)
      client.onclose = () => {
        if (online.get(familiar) === client) {
          online.delete(familiar)
        }
      }
      await previous?.close()
      arrivals.emit(String(familiar))
    },

    /**
     * Runs `call` on `familiar`'s connected computer, waking a provider's,
     * or waiting a little for a machine that's reconnecting. Says why when
     * there's none to use.
     */
    use: async <T>(
      familiar: FamiliarId,
      signal: AbortSignal | undefined,
      call: (computer: Client) => Promise<T>,
    ): Promise<T | 'none' | 'offline'> => {
      const saved = file.value[familiar]
      if (!saved) {
        return 'none'
      }
      calls.set(familiar, (calls.get(familiar) ?? 0) + 1)
      clearTimeout(idle.get(familiar))
      idle.delete(familiar)
      try {
        if (saved.provided) {
          try {
            await serially(familiar, async () => {
              const now = file.value[familiar]
              if (!now?.provided || online.has(familiar)) {
                return
              }
              if (!provider) {
                throw new Error('This host has no computer provider.')
              }
              await provider.wake(familiar, now.token)
            })
          } catch (error) {
            log(`Couldn't wake a computer: ${error}`)
            return 'offline'
          }
        }
        const computer = await arrival(
          familiar,
          saved.provided ? WAKE_MS : waitMs,
          signal,
        )
        return computer ? await call(computer) : 'offline'
      } finally {
        const left = calls.get(familiar)! - 1
        calls.set(familiar, left)
        if (!left) {
          calls.delete(familiar)
          if (file.value[familiar]?.provided && provider) {
            sleepWhenIdle(familiar)
          }
        }
      }
    },

    /**
     * Keeps computers to the workspace's Familiars: runs the check now,
     * whenever Familiars change, and every so often, so a computer removed
     * with its Familiar, or by hand in Docker, is put right. Returns a
     * function that stops it.
     */
    follow: async (workspace: Workspace) => {
      let queue: Promise<void> = Promise.resolve()
      const run = () =>
        (queue = queue
          .then(async () =>
            check(
              new Set((await workspace.familiars.list()).map(({ id }) => id)),
            ),
          )
          .catch((error) => log(`Couldn't check computers: ${error}`)))
      const watch = await workspace.familiars.watch()
      watch.start(() => run())
      const timer = setInterval(run, CHECK_EVERY_MS).unref()
      await run()
      return async () => {
        clearInterval(timer)
        await watch.stop()
        await queue
      }
    },

    /** Disconnects every computer, as the host stops. Running ones keep running. */
    close: async () => {
      idle.forEach((timer) => clearTimeout(timer))
      idle.clear()
      await Promise.all([...online.values()].map((client) => client.close()))
    },
  }
}

export type Computers = ReturnType<typeof openComputers>
