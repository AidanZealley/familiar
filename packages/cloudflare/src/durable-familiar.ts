import {
  DurableObjectSqliteDatabase,
  openDurableObjectSqliteStorage,
} from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import {
  summonFamiliar,
  type Familiar,
  type FamiliarOptions,
  type Wake,
} from '@familiar-ai/core'
import { alarmTime, alarmWriter } from './alarm.ts'

/**
 * Everything a host chooses about its Familiar: models, zone, plugins,
 * notifications, network and secrets. The adapter owns storage and waking.
 */
export type HostFamiliarOptions = Omit<
  FamiliarOptions,
  'storage' | 'now' | 'setTimer' | 'onWake'
>

export type DurableFamiliarOptions = {
  /** Called each time the object opens its Familiar, after a restart or eviction too. */
  familiar: () => HostFamiliarOptions | Promise<HostFamiliarOptions>
  /**
   * How soon work a lost process left is resumed: the alarm while anything
   * runs, and the fallback while opening. Default one minute.
   */
  heartbeatMs?: number
}

/** Refused because the Familiar was terminated. Its ID never opens again. */
export class FamiliarTerminated extends Error {
  constructor() {
    super('This Familiar was terminated.')
    this.name = 'FamiliarTerminated'
  }
}

/**
 * The object's one runtime. `opening` lasts until the Familiar is summoned;
 * meanwhile only the fallback alarm stands, because summoning resumes work
 * before it returns.
 */
type Runtime =
  | { status: 'opening' }
  | { status: 'open'; familiar: Familiar }
  | { status: 'terminated' }

const HEARTBEAT_MS = 60_000

/** Pi's tables, apart from any the host keeps in the same object. */
const PI_PREFIX = 'pi_'

/** The object's key-value record that it was terminated, and when. */
const TERMINATED = 'familiar.terminated'

/**
 * One Familiar in one SQLite-backed Durable Object. Construct it in the
 * object's constructor or a field, route `alarm()` to it, and reach the
 * Familiar only through `use()`, which arms recovery before work can start.
 */
export class DurableFamiliar {
  readonly #ctx: DurableObjectState
  readonly #heartbeatMs: number
  /**
   * Pi's database on the same storage shares this one's queue, so alarm
   * writes and termination wait for Pi's commits instead of interleaving.
   */
  readonly #database: DurableObjectSqliteDatabase
  readonly #writeAlarm: (at: number | null) => Promise<void>
  #runtime: Runtime = { status: 'opening' }

  constructor(ctx: DurableObjectState, options: DurableFamiliarOptions) {
    this.#ctx = ctx
    this.#heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
    this.#database = new DurableObjectSqliteDatabase(ctx.storage)
    this.#writeAlarm = alarmWriter(ctx, this.#database)
    // No request or alarm arrives until this settles. If it throws, the
    // object resets and the fallback alarm starts it again.
    void ctx.blockConcurrencyWhile(() => this.#open(options))
  }

  /**
   * Runs `work` with the Familiar, after arming a recovery alarm, because
   * any call can start work. Rejects with FamiliarTerminated once terminated.
   * Leave closing to `terminate()`: don't call `dismiss()`.
   */
  async use<T>(work: (familiar: Familiar) => T | Promise<T>): Promise<T> {
    const runtime = this.#runtime
    if (runtime.status !== 'open') {
      throw new FamiliarTerminated()
    }
    await this.#arm({ ...runtime.familiar.wake(), active: true })
    return work(runtime.familiar)
  }

  /** The object's `alarm()`: runs whatever is due or was cut off. */
  async alarm(): Promise<void> {
    const runtime = this.#runtime
    if (runtime.status !== 'open') {
      return this.#writeAlarm(null)
    }
    await this.#arm({ ...runtime.familiar.wake(), active: true })
    runtime.familiar.resume()
    // Pi tells onWake only of changes, and the heartbeat above wasn't one.
    // Due work already counts as active here.
    await this.#arm(runtime.familiar.wake())
  }

  /**
   * Stops the Familiar for good, keeping its history: records that it's
   * terminated and deletes the alarm in one transaction, then stops the
   * current run and closes. Later requests, alarms and restarts are refused.
   */
  async terminate(): Promise<void> {
    const runtime = this.#runtime
    // Refuses new calls at once; any late alarm write becomes a delete.
    this.#runtime = { status: 'terminated' }
    try {
      await this.#database.transaction(async () => {
        this.#ctx.storage.kv.put(TERMINATED, Date.now())
        await this.#ctx.storage.deleteAlarm()
      })
    } catch (error) {
      // Memory says terminated but storage doesn't: start again from storage.
      this.#ctx.abort('Termination failed')
      throw error
    }
    if (runtime.status === 'open') {
      try {
        await runtime.familiar.abort()
      } finally {
        await runtime.familiar.dismiss()
      }
    }
  }

  async #open(options: DurableFamiliarOptions) {
    // A stray alarm left behind is deleted by alarm() when it fires.
    if (this.#ctx.storage.kv.get(TERMINATED) !== undefined) {
      this.#runtime = { status: 'terminated' }
      return
    }

    // Armed before anything can run or throw, and kept until open.
    const fallback = Date.now() + this.#heartbeatMs
    const current = await this.#ctx.storage.getAlarm()
    if (current === null || current > fallback) {
      await this.#writeAlarm(fallback)
    }

    const familiar = await summonFamiliar({
      ...(await options.familiar()),
      storage: await openDurableObjectSqliteStorage(this.#ctx.storage, {
        prefix: PI_PREFIX,
      }),
      onWake: (wake) => void this.#arm(wake).catch(() => {}),
    })
    void familiar.closed.then((end) => {
      if (end.reason === 'failed' && this.#runtime.status !== 'terminated') {
        // Keep the recovery alarm: the next instance reopens persisted work.
        this.#ctx.abort('Familiar storage failed')
      }
    })
    this.#runtime = { status: 'open', familiar }
    await this.#arm(familiar.wake())
  }

  /** Writes the alarm `wake` asks for, as the runtime allows. */
  #arm(wake: Wake): Promise<void> {
    switch (this.#runtime.status) {
      case 'opening':
        return Promise.resolve()
      case 'terminated':
        return this.#writeAlarm(null)
      case 'open':
        return this.#writeAlarm(alarmTime(wake, Date.now(), this.#heartbeatMs))
    }
  }
}
