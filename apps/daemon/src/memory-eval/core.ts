import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { MutableModels } from '@earendil-works/pi-ai/models'
import type {
  EntryId,
  JsonObject,
  SessionDocFamilyToken,
  Storage,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { ChatModel, RoomApi, RoomId, Workspace } from '@familiar-ai/core'
import {
  Episodes,
  Facts,
  MemoryUsage,
  nextUpkeep,
  saidBy,
  type FamiliarId,
} from '@familiar-ai/core/diagnostics'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { replyTo } from '../reply.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { createClock, EVAL_TIME_ZONE, noonOf } from './clock.ts'
import { coreHash, modelName, type CoreFixture } from './core-fixture.ts'
import type { CoreScenario } from './core-scenario.ts'
import { TokenCapError, type Meter, type TokenTotals } from './model.ts'
import { entriesIn, upkeepThrough } from './unfiled.ts'

/**
 * The eval:core replay: the scenario's messages posted day by day through a
 * real workspace, on a clock that jumps from each day's messages to its
 * 04:00 upkeep. The conversation is scripted and costs nothing; only upkeep,
 * on `memoryModel`, calls a real model. Recall runs for every message as it
 * does in use, so later mentions mark the facts they find as used.
 */

/** Active days filed before measuring, and all a probe runs. */
export const PROBE_DAYS = 3

const DAY = 24 * 60 * 60 * 1000
const MESSAGE_GAP = 10 * 60 * 1000
const context = BACKGROUND_CONTEXT

export type Measure = {
  activeDays: number
  tokens: TokenTotals
  elapsedMs: number
  /** Tokens and time for every active day, at the rate so far. */
  projectedTokens: number
  projectedMs: number
}

export type CoreReplay =
  /** Every day filed: the fixture to save. */
  | { status: 'done'; measure: Measure; fixture: CoreFixture }
  /** A probe, or a run whose projection or total passed the cap. */
  | {
      status: 'stopped'
      measure?: Measure
      reason: string
      tokens: TokenTotals
    }

export type CoreReplayOptions = {
  /** Holds upkeep's provider, metered; the replay adds the scripted chat's. */
  models: MutableModels
  memoryModel: ChatModel
  meter: Meter
  /** A temporary directory for the replay's store. */
  directory: string
  /** Stop after measuring the first PROBE_DAYS active days. */
  probe?: boolean
  progress?: (message: string) => void
}

/**
 * Why a replay can't be trusted, if upkeep failed to file every message.
 * Failures only reach the runtime's own report, so a rejected key or an
 * unsupported model shows up here as memory that stopped short.
 */
export function upkeepGap(
  newest: EntryId | undefined,
  through: EntryId | null,
) {
  return newest !== undefined && (through === null || through < newest)
    ? `Upkeep filed through entry ${through ?? 'none'}, short of the last message (entry ${newest}), so it failed: check the key, the credit and that the model accepts low thinking.`
    : undefined
}

/** The calendar days from `start` to `end`, inclusive. */
function* calendar(start: string, end: string) {
  for (
    let day = new Date(`${start}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= end;
    day = new Date(day.getTime() + DAY)
  ) {
    yield day.toISOString().slice(0, 10)
  }
}

/**
 * Waits until no work runs, firing timers that fall due before `limit`,
 * such as a retry's backoff, on the eval clock. Throws once the meter has
 * stopped the run.
 */
async function settle(
  workspace: Workspace,
  clock: ReturnType<typeof createClock>,
  meter: Meter,
  limit: number,
) {
  // Work started by a timer shows as active only once it's scheduled, so
  // idle must hold for a few looks in a row.
  for (let idle = 0; idle < 3;) {
    meter.check()
    await setTimeout(idle ? 20 : 50)
    if (workspace.wake().active) {
      idle = 0
      continue
    }
    const due = clock.nextDue()
    if (due < limit) {
      clock.advanceTo(Math.max(due, clock.now()))
      idle = 0
      continue
    }
    idle++
  }
}

/** One of a Familiar's documents, read from the store once the workspace is closed. */
async function readDocument<T extends JsonObject>(
  storage: Storage,
  family: SessionDocFamilyToken<T, null>,
  familiar: FamiliarId,
) {
  const { kind } = family.definition
  const record = await storage.findDocument(
    { kind, scope: { kind: 'session' }, key: String(familiar) },
    'current',
    context,
  )
  const document =
    record && (await storage.document(record.id, 'current', context))
  if (!document) {
    throw new Error(`The replay saved no ${kind}.`)
  }
  return document.value as T
}

export async function replayCore(
  scenario: CoreScenario,
  {
    models,
    memoryModel,
    meter,
    directory,
    probe,
    progress = () => {},
  }: CoreReplayOptions,
): Promise<CoreReplay> {
  const chat = scriptedModels(
    (request) =>
      fauxAssistantMessage(
        request.type === 'background'
          ? '## Goal\nA household’s weeks.'
          : 'Noted.',
      ),
    { models: [{ id: 'eval-chat', contextWindow: 200_000 }] },
  )
  models.setProvider(chat.getProvider('faux')!)

  const path = join(directory, 'core.sqlite')
  const clock = createClock(new Date(`${scenario.start}T08:00:00`).getTime())
  const started = Date.now()
  const measure = (activeDays: number): Measure => {
    const elapsedMs = Date.now() - started
    return {
      activeDays,
      tokens: meter.totals(),
      elapsedMs,
      projectedTokens: meter.projection(activeDays, scenario.days.length),
      projectedMs: Math.round((elapsedMs / activeDays) * scenario.days.length),
    }
  }

  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(path),
      models,
      model: { provider: 'faux', modelId: 'eval-chat' },
      memoryModel,
      timeZone: EVAL_TIME_ZONE,
      now: clock.now,
      setTimer: clock.setTimer,
    },
    'Familiar',
  )
  let result: CoreReplay | undefined
  try {
    const roomOf = async (id: RoomId) => (await workspace.rooms.get(id))!
    const dmOf = async (person: string) =>
      roomOf(await workspace.rooms.dm(familiar, person))
    const shared = await roomOf(
      await workspace.rooms.create({ name: 'Home', familiars: [familiar] }),
    )
    const rooms: Record<'owner' | 'other', Record<'dm' | 'room', RoomApi>> = {
      owner: { dm: await dmOf(scenario.owner.id), room: shared },
      other: { dm: await dmOf(scenario.other.id), room: shared },
    }
    const days = new Map(scenario.days.map((day) => [day.date, day.messages]))

    let active = 0
    for (const date of calendar(scenario.start, scenario.end)) {
      const messages = days.get(date)
      for (const [index, message] of (messages ?? []).entries()) {
        clock.advanceTo(
          Math.max(clock.now(), noonOf(date) + index * MESSAGE_GAP),
        )
        const room = rooms[message.by][message.in]
        await replyTo(
          room,
          await room.post({
            author: scenario[message.by],
            text: message.text,
            requestId: `core:${date}:${index}`,
          }),
        )
      }

      // The night's upkeep, then whatever falls due before the next noon.
      clock.advanceTo(nextUpkeep(clock.now(), EVAL_TIME_ZONE))
      await settle(workspace, clock, meter, noonOf(date) + DAY)

      if (!messages) {
        continue
      }
      active++
      progress(
        `Filed ${date}: ${meter.totals().total.toLocaleString()} tokens so far`,
      )
      if (active === PROBE_DAYS) {
        const measured = measure(active)
        if (measured.tokens.total === 0) {
          result = {
            status: 'stopped',
            measure: measured,
            reason: `Upkeep used no tokens in ${PROBE_DAYS} active days, so it is failing: check the key, the credit and that the model accepts low thinking.`,
            tokens: measured.tokens,
          }
          break
        }
        if (probe) {
          result = {
            status: 'stopped',
            measure: measured,
            reason: 'Probe done.',
            tokens: measured.tokens,
          }
          break
        }
        if (measured.projectedTokens > meter.cap) {
          result = {
            status: 'stopped',
            measure: measured,
            reason: `Projected ${measured.projectedTokens.toLocaleString()} tokens, past the cap of ${meter.cap.toLocaleString()}.`,
            tokens: measured.tokens,
          }
          break
        }
        progress(
          `Measured ${PROBE_DAYS} days: ${measured.tokens.total.toLocaleString()} tokens in ${Math.round(measured.elapsedMs / 1000)}s; projected ${measured.projectedTokens.toLocaleString()} tokens`,
        )
      }
    }
  } catch (error) {
    if (!(error instanceof TokenCapError)) {
      throw error
    }
    result = {
      status: 'stopped',
      reason: error.message,
      tokens: meter.totals(),
    }
  } finally {
    await workspace.dismiss()
  }
  if (result) {
    return result
  }

  const storage = await openNodeSqliteStorage(path)
  try {
    const gap = upkeepGap(
      (await entriesIn(storage, familiar)).findLast(saidBy)?.id,
      await upkeepThrough(storage, familiar),
    )
    if (gap) {
      return { status: 'stopped', reason: gap, tokens: meter.totals() }
    }
    const measured = measure(scenario.days.length)
    return {
      status: 'done',
      measure: measured,
      fixture: {
        scenario: scenario.id,
        hash: coreHash(scenario, memoryModel),
        model: modelName(memoryModel),
        facts: await readDocument(storage, Facts, familiar),
        usage: await readDocument(storage, MemoryUsage, familiar),
        episodes: await readDocument(storage, Episodes, familiar),
        clock: clock.now(),
        tokens: measured.tokens,
        elapsedMs: measured.elapsedMs,
      },
    }
  } finally {
    await storage.close(context)
  }
}
