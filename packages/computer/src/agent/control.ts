import type { ComputerCall } from '../host.ts'

/**
 * Who has the computer: the Familiar, a person (who took it over, or is
 * taking it), or the Familiar again but not yet told (the person handed it
 * back). Only this module changes it.
 */
export type Control = 'familiar' | 'person' | 'returned'

/**
 * What a Familiar's call does to the computer: whether it only looks, and
 * whether it uses the display (the browser and screen tools). An action on
 * the display would fight a person's mouse and keys; even a look may change
 * it, as a browser read starts the browser if it isn't running.
 */
export type CallKind = { reads: boolean; display: boolean }

/** A call's outcome: it ran, or not, and what to tell the Familiar first. */
export type Outcome<T> =
  { ran: true; value: T; note?: string } | { ran: false; note: string }

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
 * The agent's `Control`, the one place it changes, and the one place that
 * admits the Familiar's calls. A person's hold lasts exactly as long as its
 * signal. From the moment they ask, the Familiar's actions wait and never
 * run, and its reads run with a note; they get control once the calls on
 * the display already running have finished, so none lands under their
 * hands.
 * The first call after the hand back carries a note, so a take-over between
 * calls is reported too.
 */
export function computerControl() {
  let state: Control = 'familiar'
  /** Settles when the person hands back. */
  let handedBack = Promise.resolve()
  /** The Familiar's actions waiting for the hand back. */
  const waiting = new Set<ComputerCall>()
  /** The calls on the display running now that may change it. */
  const displaying = new Set<Promise<unknown>>()

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
      // No action starts from here on, and those on the display finish.
      state = 'person'
      let handBack!: () => void
      handedBack = new Promise((resolve) => (handBack = resolve))
      await Promise.race([Promise.allSettled([...displaying]), aborted(signal)])
      if (!signal.aborted) {
        onHeld()
        await aborted(signal)
      }
      state = 'returned'
      handBack()
      return undefined
    },
    /**
     * Runs the Familiar's `call` with `act`, if it may run now. An action
     * while a person has control waits (`onWait` when it starts to) and then
     * never runs; reads never wait, and `act` hears whether a person is
     * using the computer as they run. Throws if `signal` aborts while waiting.
     */
    run: async <T>(
      call: ComputerCall,
      kind: CallKind,
      signal: AbortSignal,
      onWait: () => void,
      act: (using: boolean) => Promise<T>,
    ): Promise<Outcome<T>> => {
      let note: string | undefined
      if (state === 'returned') {
        state = 'familiar'
        if (!kind.reads) {
          return { ran: false, note: USED_NOT_RUN }
        }
        note = USED
      } else if (state === 'person') {
        if (!kind.reads) {
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
          return { ran: false, note: WAITED }
        }
        note = USING
      }
      // Admitted in the same turn as the checks above, so a take-over
      // either came first and stopped it, or waits for it.
      const running = act(note === USING)
      // Admitted while the Familiar has it, a call on the display may
      // change it (even a look, starting the browser): a take-over waits for
      // it. One admitted while a person has it is a look that changes nothing.
      if (kind.display && note !== USING) {
        displaying.add(running)
        const done = () => displaying.delete(running)
        running.then(done, done)
      }
      return { ran: true, value: await running, note }
    },
    /** Whether `call` is waiting for the person to hand back. */
    waits: (call: ComputerCall) => waiting.has(call),
  }
}

export type ComputerControl = ReturnType<typeof computerControl>
