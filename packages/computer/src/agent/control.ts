import type { ComputerCall } from '../host.ts'

/**
 * Who has the computer: the Familiar, a person (who took it over), or the
 * Familiar again but not yet told (the person handed it back). Only this
 * module changes it.
 */
export type Control = 'familiar' | 'person' | 'returned'

/** What a Familiar's call may do now: run, and what to tell the Familiar first. */
export type Turn = { run: boolean; note?: string }

const USING =
  'A person has taken over your computer and is using it now, so the screen may change under you.'
const WAITED =
  "A person took over your computer while this waited, so it didn't run. Look at the screen again before acting."
const USED =
  'A person used your computer since your last call, so the screen may have changed.'
const USED_NOT_RUN = `${USED} This didn't run: look again before acting.`

/** Settles when `signal` aborts. */
const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) =>
    signal.aborted
      ? resolve()
      : signal.addEventListener('abort', () => resolve(), { once: true }),
  )

/**
 * The agent's `Control`, the one place it changes. A person's hold lasts
 * exactly as long as its signal; while it lasts, the Familiar's actions
 * wait and never run, and its reads run with a note. The first call after
 * the hand back carries a note, so a take-over between calls is reported
 * too.
 */
export function computerControl() {
  let state: Control = 'familiar'
  /** Settles when the person hands back. */
  let handedBack = Promise.resolve()
  /** The Familiar's actions waiting for the hand back. */
  const waiting = new Set<ComputerCall>()

  return {
    /**
     * Gives a person the computer until `signal` aborts, calling `onHeld`
     * once they have it, or answers why not: someone else has it.
     */
    hold: async (
      signal: AbortSignal,
      onHeld: () => void,
    ): Promise<string | undefined> => {
      if (state === 'person') {
        return 'Someone else is using this computer.'
      }
      if (signal.aborted) {
        return undefined
      }
      state = 'person'
      let handBack!: () => void
      handedBack = new Promise((resolve) => (handBack = resolve))
      onHeld()
      await aborted(signal)
      state = 'returned'
      handBack()
      return undefined
    },
    /**
     * Whether the Familiar's `call`, starting now, may run. An action while
     * the person has control waits (`onWait` when it starts to) and then
     * never runs; reads never wait. Throws if `signal` aborts while waiting.
     */
    turn: async (
      call: ComputerCall,
      reads: boolean,
      signal: AbortSignal,
      onWait: () => void,
    ): Promise<Turn> => {
      if (state === 'returned') {
        state = 'familiar'
        return reads
          ? { run: true, note: USED }
          : { run: false, note: USED_NOT_RUN }
      }
      if (state === 'familiar') {
        return { run: true }
      }
      if (reads) {
        return { run: true, note: USING }
      }
      waiting.add(call)
      try {
        onWait()
        await Promise.race([handedBack, aborted(signal)])
      } finally {
        waiting.delete(call)
      }
      signal.throwIfAborted()
      // Unless someone has taken over again already (`state` may have
      // changed while waiting).
      if ((state as Control) === 'returned') {
        state = 'familiar'
      }
      return { run: false, note: WAITED }
    },
    /** Whether `call` is waiting for the person to hand back. */
    waits: (call: ComputerCall) => waiting.has(call),
  }
}

export type ComputerControl = ReturnType<typeof computerControl>
