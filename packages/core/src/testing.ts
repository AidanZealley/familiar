import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  type FauxModelDefinition,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage, type SetTimer } from '@earendil-works/pi-durable'
import { onTestFinished } from 'vitest'
import type { Author } from './conversation/message.ts'
import { summonFamiliar, type Familiar, type FamiliarOptions } from './index.ts'
import { parseMinute } from './time.ts'

/** Test helpers; not part of Familiar. */

/** A clock that moves only when told to, firing the timers that fall due. */
export function fakeClock(start: number) {
  let now = start
  let timers: { due: number; fire: () => void }[] = []
  const setTimer: SetTimer = (fire, delayMs, { background }) => {
    if (background) {
      return undefined
    } // only frees memory
    const timer = { due: now + delayMs, fire }
    timers.push(timer)
    return () => {
      timers = timers.filter((other) => other !== timer)
    }
  }
  const advanceTo = (time: number) => {
    now = time
    const due = timers.filter((timer) => timer.due <= now)
    timers = timers.filter((timer) => timer.due > now)
    for (const timer of due) {
      timer.fire()
    }
  }
  return {
    now: () => now,
    setTimer,
    advanceTo,
    setTime: (time: number) => {
      now = time
    },
  }
}

/** The zone tests read calendars in unless they test another. Clocks go back on 2026-10-25. */
export const TEST_ZONE = 'Europe/London'

/** The time of `YYYY-MM-DD HH:MM` in `timeZone`. */
export function timeAt(minute: string, timeZone = TEST_ZONE) {
  const at = parseMinute(minute, timeZone)
  if (at === undefined) {
    throw new Error(`${minute} doesn't exist in ${timeZone}.`)
  }
  return at
}

/** Models whose only provider is `faux`, which scripts what they say. */
export function fauxModels(definitions?: FauxModelDefinition[]) {
  const faux = fauxProvider(definitions && { models: definitions })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

/** Keeps committed state available after Familiar closes its storage. */
export class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

const AIDAN: Author = { id: 'aidan', name: 'aidan' }

/**
 * A Familiar on faux models over storage a restart can reopen, dismissed
 * after the test. `options` are passed to `summonFamiliar`; `faux` lists the
 * faux provider's models when a test needs particular ones.
 */
export async function testHost(
  options: Partial<FamiliarOptions> & { faux?: FauxModelDefinition[] } = {},
) {
  const { faux: definitions, ...familiarOptions } = options
  const { faux, models } = fauxModels(definitions)
  const storage = familiarOptions.storage ?? new ReopenableStorage()
  let current: FamiliarOptions = {
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    ...familiarOptions,
    storage,
  }
  let familiar: Familiar | undefined = await summonFamiliar(current)
  onTestFinished(() => familiar?.dismiss())

  const dismiss = async () => {
    const closing = familiar
    familiar = undefined
    await closing?.dismiss()
  }

  return {
    faux,
    models,
    storage,
    familiar: () => {
      if (!familiar) {
        throw new Error('This Familiar was dismissed.')
      }
      return familiar
    },
    /** Dismisses it before the test ends, such as to read its storage. */
    dismiss,
    /**
     * Closes it and opens another over the same storage, as a restart does,
     * after `meanwhile` changes the storage, with `changes` to its options.
     */
    reopen: async (
      changes: Partial<FamiliarOptions> = {},
      meanwhile?: () => Promise<void>,
    ) => {
      await dismiss()
      await meanwhile?.()
      current = { ...current, ...changes }
      familiar = await summonFamiliar(current)
      return familiar
    },
    /** Sends `text` from `author` and waits for every reply. */
    say: async (text: string, author: Author = AIDAN) => {
      await familiar!.send({
        author,
        text,
        // Each test message starts differently; a request ID has a bound.
        requestId: text.slice(0, 128),
      })
      await familiar!.idle()
    },
  }
}

export type TestHost = Awaited<ReturnType<typeof testHost>>

/** A Familiar on faux models and memory storage, dismissed after the test. */
export const testFamiliar = async (options: Partial<FamiliarOptions> = {}) =>
  (await testHost(options)).familiar()

/** The input a request answers: its last user message, before any recall note. */
export const inputOf = (context: TranscriptContext) =>
  context.messages
    .map((message) =>
      message.role !== 'user'
        ? ''
        : typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(''),
    )
    .findLast((text) => text && !text.startsWith('Recalled from memory')) ?? ''
