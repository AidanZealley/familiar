import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  type FauxModelDefinition,
} from '@earendil-works/pi-ai/providers/faux'
import {
  MemoryStorage,
  type EntryId,
  type SetTimer,
} from '@earendil-works/pi-durable'
import { onTestFinished } from 'vitest'
import type { Author } from './conversation/message.ts'
import {
  openWorkspace,
  type RoomApi,
  type RoomMessage,
  type WorkspaceOptions,
} from './index.ts'
import { RECALL_HEADING } from './memory/recall.ts'
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

export type TestHostOptions = Partial<WorkspaceOptions> & {
  /** Familiar #1's name, set on every open. Default `Familiar`. */
  name?: string
  /** Familiar #1's persona, set on every open. */
  persona?: string
  /** The faux provider's models, when a test needs particular ones. */
  faux?: FauxModelDefinition[]
}

/** The reply in `room` that answers `entry`, once there is one. */
export const replyTo = (room: RoomApi, entry: EntryId) => room.replyTo(entry)

/**
 * A workspace on faux models over storage a restart can reopen, dismissed
 * after the test, with one Familiar and aidan's DM with it.
 */
export async function testHost(options: TestHostOptions = {}) {
  const { faux: definitions, ...rest } = options
  const { faux, models } = fauxModels(definitions)
  let current: TestHostOptions & WorkspaceOptions = {
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    ...rest,
    storage: rest.storage ?? new ReopenableStorage(),
  }

  const open = async () => {
    const { name = 'Familiar', persona, ...workspaceOptions } = current
    const workspace = await openWorkspace(workspaceOptions)
    try {
      const [first] = await workspace.familiars.list()
      if (first) {
        await workspace.familiars.update(first.id, {
          name,
          persona: persona ?? null,
        })
      }
      const familiar = first
        ? workspace.familiars.get(first.id)!
        : await workspace.familiars.create({
            name,
            ...(persona !== undefined && { persona }),
          })
      const dm = (await workspace.rooms.get(
        await workspace.rooms.dm(familiar.id, AIDAN.id),
      ))!
      return { workspace, familiar, dm }
    } catch (error) {
      await workspace.dismiss()
      throw error
    }
  }

  let opened: Awaited<ReturnType<typeof open>> | undefined = await open()
  onTestFinished(() => opened?.workspace.dismiss())

  const dismiss = async () => {
    const closing = opened
    opened = undefined
    await closing?.workspace.dismiss()
  }
  const live = () => {
    if (!opened) {
      throw new Error('This workspace was dismissed.')
    }
    return opened
  }

  return {
    faux,
    models,
    storage: current.storage,
    workspace: () => live().workspace,
    familiar: () => live().familiar,
    /** Aidan's DM with the Familiar. */
    dm: () => live().dm,
    /** Dismisses it before the test ends, such as to read its storage. */
    dismiss,
    /**
     * Closes it and opens another over the same storage, as a restart does,
     * after `meanwhile` changes the storage, with `changes` to its options.
     */
    reopen: async (
      changes: Partial<TestHostOptions> = {},
      meanwhile?: () => Promise<void>,
    ) => {
      await dismiss()
      await meanwhile?.()
      current = { ...current, ...changes }
      opened = await open()
      return opened
    },
    /** Posts `message` to the DM and waits for the reply. */
    send: async (message: RoomMessage) => {
      const { dm } = live()
      return replyTo(dm, await dm.post(message))
    },
    /** Posts `text` from `author` to the DM and waits for the reply. */
    say: async (text: string, author: Author = AIDAN) => {
      const { dm } = live()
      // Each test message starts differently; a request ID has a bound.
      const entry = await dm.post({
        author,
        text,
        requestId: text.slice(0, 128),
      })
      await replyTo(dm, entry)
    },
  }
}

export type TestHost = Awaited<ReturnType<typeof testHost>>

/** A workspace's Familiar on faux models and memory storage, dismissed after the test. */
export const testFamiliar = async (options: TestHostOptions = {}) =>
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
    .findLast((text) => text && !text.startsWith(RECALL_HEADING)) ?? ''
