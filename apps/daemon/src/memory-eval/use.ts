import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { MutableModels } from '@earendil-works/pi-ai/models'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { ModelChoice, RoomApi, Workspace } from '@familiar-ai/core'
import {
  CORE_IMPORTANCE,
  Facts,
  isPast,
  localDay,
  MemoryUsage,
  rebalanceCore,
  searchMemory,
  type Fact,
  type FamiliarId,
} from '@familiar-ai/core/diagnostics'
import { createModels } from '@familiar-ai/core/models'
import { replyTo } from '../reply.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { createClock, EVAL_TIME_ZONE } from './clock.ts'
import { modelName, type CoreFixture } from './core-fixture.ts'
import { TokenCapError, type Meter, type TokenTotals } from './model.ts'
import type { ProbeKind, SeedFact, UseProbe } from './use-probes.ts'

/**
 * The eval:use runner: each probe in a fresh workspace on a real chat
 * model, with its facts planted and placed by `rebalanceCore` as in use.
 * Upkeep never runs, since the clock stays on the probe's morning and never
 * reaches 04:00, so this measures the reply model's use of memory alone.
 *
 * A proactive probe runs three ways, so the grade can say what core and
 * recall each contribute: its facts pinned into core, its facts rated just
 * below core's threshold so only recall can bring them up, and no facts.
 */

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
/** A Saturday morning, so every run places facts and answers on the same day. */
const PROBE_TIME = new Date('2026-03-14T10:00:00').getTime()
/** A reply that hasn't come by now never will. */
const REPLY_TIMEOUT = 3 * 60 * 1000
const context = BACKGROUND_CONTEXT

export type Rate = { passed: number; total: number; rate: number }

/**
 * Where a run's facts sit:
 * - `core`: the facts under test are pinned into core;
 * - `outside`: they are rated below core's threshold, so they sit outside it;
 * - `placed`: all facts are as seeded, or as the fixture's, and ranked as in use;
 * - `none`: no facts at all.
 */
export type Placement = 'core' | 'outside' | 'placed' | 'none'

/** One run of a probe: the reply and why it passed or not. */
export type UseOutcome = {
  probe: string
  kind: ProbeKind
  placement: Placement
  /**
   * For an `outside` run: whether automatic recall's note held a fact under
   * test, which is whether its words matched the request. Without it the
   * reply has only what the model asks memory for itself.
   */
  recalled?: boolean
  /** The model searched memory itself, with its `recall` tool. */
  asked: boolean
  passed: boolean
  /** It posted a reply rather than staying quiet. */
  answered: boolean
  /** No required string was in the reply. */
  missing: boolean
  /** The forbidden strings it contained. */
  forbidden: string[]
  reply: string
}

export type UseGrade = {
  proactive: {
    /** With the facts in core (or, from a fixture, as the replay left them). */
    with: Rate
    /** With the facts outside core. */
    outside: Rate
    without: Rate
    /** `with` over `without`: what memory adds. */
    gain: number
    /**
     * Among probes that pass with the facts in core, those that still pass
     * with them outside: how much of core's job recall does.
     */
    rescue: Rate
    /** Outside runs in which automatic recall's words matched the fact. */
    recalled: Rate
    /** Outside runs in which the model searched memory itself. */
    asked: Rate
  }
  restraint: Rate
  attribution: Rate
  outcomes: UseOutcome[]
  /** Probes a fixture's facts didn't cover, so they didn't run. */
  skipped: string[]
  /** The fixture the facts came from, if not each probe's own. */
  fixture?: string
  /** The chat model, `provider/modelId@level`. */
  model: string
  tokens: TokenTotals
  elapsedMs: number
}

export type UseMeasure = {
  runs: number
  tokens: TokenTotals
  elapsedMs: number
  /** Tokens and time for every run, at the rate so far. */
  projectedTokens: number
  projectedMs: number
}

export type UseRun =
  | { status: 'done'; measure: UseMeasure; grade: UseGrade }
  /** A probe, or a run whose projection or total passed the cap. */
  | {
      status: 'stopped'
      measure?: UseMeasure
      reason: string
      tokens: TokenTotals
    }

export type UseOptions = {
  probes: readonly UseProbe[]
  /** Seeds every probe from this replay's current facts instead of its own, running only the probes it covers. */
  fixture?: CoreFixture
  /** Holds the chat model's provider, metered. */
  models: MutableModels
  chat: ModelChoice
  meter: Meter
  /** A temporary directory for the runs' stores. */
  directory: string
  /** Stop after measuring one probe of each kind. */
  probe?: boolean
  progress?: (message: string) => void
}

const has = (text: string, part: string) =>
  text.toLowerCase().includes(part.toLowerCase())

/**
 * Whether the fixture's current facts hold what the probe tests. For a
 * proactive probe that is something the reply must say; for the others,
 * something it must hold back (or the probe's `topic`). Any one will do.
 */
export function covers(fixture: CoreFixture, probe: UseProbe) {
  const strings =
    probe.topic ??
    (probe.kind === 'proactive' ? probe.required : probe.forbidden)
  const current = fixture.facts.facts.filter((fact) => !isPast(fact))
  return strings.some((part) => current.some((fact) => has(fact.text, part)))
}

/**
 * The facts as upkeep writes them, naming whom they are about. Under
 * `core` and `outside` the fact under test is forced there; background
 * facts keep their rating.
 */
const seedFact = (
  { about, text, importance, savedDaysAgo = 30, background }: SeedFact,
  number: number,
  placement: Placement,
): Fact => {
  const saved = PROBE_TIME - savedDaysAgo * DAY
  const forced = !background
  return {
    id: `f${number}`,
    text: `${about.name} (author ID ${about.id}) ${text}`,
    importance:
      forced && placement === 'outside'
        ? Math.min(importance, CORE_IMPORTANCE - 1)
        : importance,
    since: localDay(saved, EVAL_TIME_ZONE),
    sources: [],
    saved,
    core: false,
    ...(forced && placement === 'core' ? { pinned: true } : {}),
  }
}

type Planted = {
  /** Under `outside`: whether automatic recall's words matched a fact under test. */
  recalled?: boolean
}

/**
 * Plants memory in a store that has its Familiar, through a bare Harness,
 * and has `rebalanceCore` place it. No owner API adds a fact, and the model
 * can't save one until upkeep runs. A forced placement that ranking doesn't
 * give throws, so a change to core's rules can't quietly make the split
 * measure something else.
 */
async function plant(
  path: string,
  familiar: FamiliarId,
  seed: { probe: UseProbe; placement: Placement } | CoreFixture,
): Promise<Planted> {
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    { models: createModels(), registry: createRegistry() },
    context,
  )
  try {
    return await harness.commit(async (tx): Promise<Planted> => {
      const facts = await tx.doc(Facts, String(familiar), null)
      const usage = await tx.doc(MemoryUsage, String(familiar), null)
      if (!('probe' in seed)) {
        facts.facts = structuredClone(seed.facts.facts)
        facts.next = seed.facts.next
        usage.facts = structuredClone(seed.usage.facts)
        rebalanceCore({ facts, usage })
        return {}
      }
      const { probe, placement } = seed
      const tested = probe.facts.flatMap((fact, index) =>
        fact.background ? [] : [`f${facts.next + index}`],
      )
      probe.facts.forEach((fact, index) =>
        facts.facts.push(seedFact(fact, facts.next + index, placement)),
      )
      facts.next += probe.facts.length
      rebalanceCore({ facts, usage })
      if (placement === 'placed') {
        return {}
      }
      const misplaced = facts.facts.filter(
        (fact) =>
          tested.includes(fact.id) && fact.core !== (placement === 'core'),
      )
      if (misplaced.length) {
        throw new Error(
          `${probe.id}: ${misplaced.map((fact) => fact.id).join(', ')} should be ${placement === 'core' ? 'in' : 'outside'} core but ranking put ${placement === 'core' ? 'it outside' : 'it in'}.`,
        )
      }
      if (placement !== 'outside') {
        return {}
      }
      // The request as the workspace will search it, over the planted facts.
      const found = searchMemory(
        facts,
        undefined,
        probe.request,
        PROBE_TIME,
        EVAL_TIME_ZONE,
      ).found
      return {
        recalled: found.some(
          ({ item }) => 'fact' in item && tested.includes(item.fact.id),
        ),
      }
    }, context)
  } finally {
    await harness.close(context)
  }
}

type ReplyMessage = { role: string; content?: unknown }

/** Whether a reply's assistant messages call the `recall` tool. */
const askedMemory = (messages: ReplyMessage[]) =>
  messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type: string; name?: string }) =>
          part.type === 'toolCall' && part.name === 'recall',
      ),
  )

/** The text of a reply's assistant messages. */
const replyText = (messages: ReplyMessage[]): string =>
  messages
    .flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content.flatMap((part: { type: string; text?: string }) =>
            part.type === 'text' ? [part.text ?? ''] : [],
          )
        : [],
    )
    .join('\n')
    .trim()

type Planned = { probe: UseProbe; placement: Placement }

/**
 * What each proactive probe runs as: facts in core, outside it, and none. A
 * fixture's facts have their own placement, so they run as the replay left
 * them and with none. The other kinds run with their facts as seeded.
 */
const runsOf = (probe: UseProbe, fixture?: CoreFixture): Planned[] =>
  (probe.kind === 'proactive'
    ? fixture
      ? (['placed', 'none'] as const)
      : (['core', 'outside', 'none'] as const)
    : (['placed'] as const)
  ).map((placement) => ({ probe, placement }))

const tally = (passed: number, total: number): Rate => ({
  passed,
  total,
  rate: total ? round(passed / total) : 0,
})

const rate = (outcomes: UseOutcome[]) =>
  tally(outcomes.filter((outcome) => outcome.passed).length, outcomes.length)

const round = (value: number) => Math.round(value * 1000) / 1000

export function gradeUse(
  outcomes: UseOutcome[],
  rest: Pick<
    UseGrade,
    'skipped' | 'fixture' | 'model' | 'tokens' | 'elapsedMs'
  >,
): UseGrade {
  const of = (kind: ProbeKind, ...placements: Placement[]) =>
    outcomes.filter(
      (outcome) =>
        outcome.kind === kind && placements.includes(outcome.placement),
    )
  const withMemory = rate(of('proactive', 'core', 'placed'))
  const without = rate(of('proactive', 'none'))
  const outside = of('proactive', 'outside')
  const reachable = new Set(
    of('proactive', 'core')
      .filter((outcome) => outcome.passed)
      .map((outcome) => outcome.probe),
  )
  return {
    proactive: {
      with: withMemory,
      outside: rate(outside),
      without,
      gain: round(withMemory.rate - without.rate),
      rescue: rate(outside.filter((outcome) => reachable.has(outcome.probe))),
      recalled: tally(
        outside.filter((outcome) => outcome.recalled).length,
        outside.length,
      ),
      asked: tally(
        outside.filter((outcome) => outcome.asked).length,
        outside.length,
      ),
    },
    restraint: rate(of('restraint', 'placed')),
    attribution: rate(of('attribution', 'placed')),
    outcomes,
    ...rest,
  }
}

export async function runUseEval({
  probes,
  fixture,
  models,
  chat,
  meter,
  directory,
  probe: probeOnly,
  progress = () => {},
}: UseOptions): Promise<UseRun> {
  const eligible = probes.filter((probe) => !fixture || covers(fixture, probe))
  const skipped = probes.filter((p) => !eligible.includes(p)).map((p) => p.id)

  // One probe of each kind first: the sample the cap's projection is made from.
  const sample = (['proactive', 'restraint', 'attribution'] as const).flatMap(
    (kind) => eligible.find((probe) => probe.kind === kind) ?? [],
  )
  const ordered = [...sample, ...eligible.filter((p) => !sample.includes(p))]
  const planned = ordered.flatMap((probe) => runsOf(probe, fixture))
  const sampled = sample.flatMap((probe) => runsOf(probe, fixture)).length

  if (planned.length === 0) {
    return {
      status: 'stopped',
      reason: `The fixture covers none of the ${probes.length} probes.`,
      tokens: meter.totals(),
    }
  }

  const started = Date.now()
  const measure = (runs: number): UseMeasure => {
    const elapsedMs = Date.now() - started
    return {
      runs,
      tokens: meter.totals(),
      elapsedMs,
      projectedTokens: meter.projection(runs, planned.length),
      projectedMs: Math.round((elapsedMs / runs) * planned.length),
    }
  }

  async function run({ probe, placement }: Planned): Promise<UseOutcome> {
    const path = join(directory, `${probe.id}-${placement}.sqlite`)
    const clock = createClock(fixture ? fixture.clock + 8 * HOUR : PROBE_TIME)
    const open = async () =>
      openDaemonWorkspace(
        {
          storage: await openNodeSqliteStorage(path),
          models,
          chatModel: chat.model,
          modelChoices: [chat],
          timeZone: EVAL_TIME_ZONE,
          now: clock.now,
          setTimer: clock.setTimer,
        },
        'Familiar',
      )
    const opened = await open()
    const { familiar } = opened
    let { workspace } = opened
    let planted: Planted = {}
    try {
      if (placement !== 'none') {
        await workspace.dismiss()
        planted = await plant(path, familiar, fixture ?? { probe, placement })
        ;({ workspace } = await open())
      }
      const room = await roomFor(workspace, familiar, probe)
      const entry = await room.post({
        author: probe.asker,
        text: probe.request,
        requestId: `use:${probe.id}`,
      })
      const timeout = new AbortController()
      const reply = await Promise.race([
        replyTo(room, entry),
        setTimeout(REPLY_TIMEOUT, undefined, { signal: timeout.signal }).then(
          () => {
            // A cap abort leaves no reply; report it as the cap, not a hang.
            meter.check()
            throw new Error(`${probe.id} got no reply in time.`)
          },
        ),
      ]).finally(() => timeout.abort())
      // A run the meter stopped fails like any other; say why.
      meter.check()
      if (reply.outcome === 'failed' || reply.outcome === 'stopped') {
        throw new Error(
          `${probe.id} ${reply.outcome} without a reply: check the key, the credit and the model.`,
        )
      }
      const text = replyText(reply.messages)
      const answered = reply.outcome === 'answered'
      const missing =
        probe.required.length > 0 &&
        !probe.required.some((part) => has(text, part))
      const forbidden = probe.forbidden.filter((part) => has(text, part))
      return {
        probe: probe.id,
        kind: probe.kind,
        placement,
        ...(planted.recalled === undefined
          ? {}
          : { recalled: planted.recalled }),
        asked: askedMemory(reply.messages),
        passed: answered && !missing && forbidden.length === 0,
        answered,
        missing,
        forbidden,
        reply: text,
      }
    } finally {
      await workspace.dismiss()
    }
  }

  const outcomes: UseOutcome[] = []
  const tokens = () => meter.totals()
  try {
    for (const [index, step] of planned.entries()) {
      const outcome = await run(step)
      outcomes.push(outcome)
      progress(
        `${outcome.passed ? 'pass' : 'fail'} ${step.probe.id} (${step.placement}): ${tokens().total.toLocaleString()} tokens so far`,
      )
      if (index + 1 !== sampled) {
        continue
      }
      const measured = measure(sampled)
      if (measured.tokens.total === 0) {
        return {
          status: 'stopped',
          measure: measured,
          reason:
            'The sample used no tokens, so the model is failing: check the key and the credit.',
          tokens: measured.tokens,
        }
      }
      if (probeOnly) {
        return {
          status: 'stopped',
          measure: measured,
          reason: 'Probe done.',
          tokens: measured.tokens,
        }
      }
      if (measured.projectedTokens > meter.cap) {
        return {
          status: 'stopped',
          measure: measured,
          reason: `Projected ${measured.projectedTokens.toLocaleString()} tokens, past the cap of ${meter.cap.toLocaleString()}.`,
          tokens: measured.tokens,
        }
      }
    }
  } catch (error) {
    if (!(error instanceof TokenCapError)) {
      throw error
    }
    return { status: 'stopped', reason: error.message, tokens: tokens() }
  }

  const measured = measure(planned.length)
  return {
    status: 'done',
    measure: measured,
    grade: gradeUse(outcomes, {
      skipped,
      fixture: fixture?.hash,
      model: modelName(chat),
      tokens: measured.tokens,
      elapsedMs: measured.elapsedMs,
    }),
  }
}

/** The room a probe is asked in: the asker's DM, or the shared room "Home". */
async function roomFor(
  workspace: Workspace,
  familiar: FamiliarId,
  probe: UseProbe,
): Promise<RoomApi> {
  const id =
    probe.place === 'dm'
      ? await workspace.rooms.dm(familiar, probe.asker.id)
      : await workspace.rooms.create({ name: 'Home', familiars: [familiar] })
  return (await workspace.rooms.get(id))!
}
