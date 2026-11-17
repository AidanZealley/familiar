import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import type { FamiliarId } from '@familiar-ai/core'
import { encryptedJsonFile } from '@familiar-ai/core/node'
import { Client, type Transport } from '@modelcontextprotocol/client'

/** Each Familiar's computer, by FamiliarId: its pairing token. */
type Saved = Record<string, { token: string }>

export type ComputerStatus = 'none' | 'offline' | 'online'

export type ComputersOptions = {
  /** The encrypted file computers are kept in. */
  path: string
  /** The host's vault key, shared with its other encrypted files. */
  keyPath: string
  /**
   * How long a call waits for a computer that isn't connected, such as one
   * reconnecting after the host restarted, before saying it's offline.
   * Default 10 seconds.
   */
  waitMs?: number
}

const hash = (token: string) => createHash('sha256').update(token).digest()

/**
 * The one owner of which Familiars have a computer and how each pairs,
 * saved under the host's key, and of the computers connected now. A
 * computer is whatever runs the agent with its pairing token: it connects
 * in, and the host is the MCP client of the agent's server.
 */
export function openComputers(options: ComputersOptions) {
  const file = encryptedJsonFile<Saved>(
    options.path,
    options.keyPath,
    'computers',
    () => ({}),
  )
  const online = new Map<FamiliarId, Client>()
  const arrivals = new EventEmitter()
  const waitMs = options.waitMs ?? 10_000

  return {
    status: (familiar: FamiliarId): ComputerStatus =>
      !file.value[familiar]
        ? 'none'
        : online.has(familiar)
          ? 'online'
          : 'offline',

    /**
     * Gives `familiar` a computer, or pairs its computer afresh, returning
     * the new pairing token. A machine paired with an earlier token is
     * disconnected and can't connect again.
     */
    pair: (familiar: FamiliarId) => {
      const token = randomBytes(32).toString('base64url')
      file.save({ ...file.value, [familiar]: { token } })
      void online.get(familiar)?.close()
      return token
    },

    /** The Familiar whose computer `token` pairs, if any. */
    familiarFor: (token: string) => {
      const given = hash(token)
      const found = Object.entries(file.value).find(([, saved]) =>
        timingSafeEqual(hash(saved.token), given),
      )
      return found && (Number(found[0]) as FamiliarId)
    },

    /**
     * Uses the agent at the other end of `transport` as `familiar`'s
     * computer, in place of any connected before.
     */
    connect: async (familiar: FamiliarId, transport: Transport) => {
      const client = new Client({ name: 'familiar', version: '1.0.0' })
      await client.connect(transport, { timeout: 15_000 })
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
     * `familiar`'s connected computer, waiting a little for one that's
     * reconnecting, or why there's none.
     */
    reach: async (
      familiar: FamiliarId,
      signal?: AbortSignal,
    ): Promise<Client | 'none' | 'offline'> => {
      if (!file.value[familiar]) {
        return 'none'
      }
      if (!online.has(familiar)) {
        await once(arrivals, String(familiar), {
          signal: AbortSignal.any([
            AbortSignal.timeout(waitMs),
            ...(signal ? [signal] : []),
          ]),
        }).catch(() => {})
      }
      return online.get(familiar) ?? 'offline'
    },

    /** Disconnects every computer, as the host stops. */
    close: async () => {
      await Promise.all([...online.values()].map((client) => client.close()))
    },
  }
}

export type Computers = ReturnType<typeof openComputers>
