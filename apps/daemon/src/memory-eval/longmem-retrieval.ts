import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import {
  datesIn,
  localDay,
  memoryViews,
  type Exchange,
} from '@familiar-ai/core/diagnostics'
import { createModels } from '@familiar-ai/core/models'
import { EVAL_TIME_ZONE } from './clock.ts'
import type { HistoryStore } from './longmem-history.ts'
import type { Question, QuestionType } from './longmem-data.ts'

/**
 * Retrieval recall: whether memory's search puts the evidence for a question
 * in its top k exchanges. No model is involved, so it is free, deterministic
 * and runs on every question, and it measures the search layer on its own.
 */

/** The ks reported. */
export const KS = [5, 10] as const

/** Question in, ranked exchanges out: the one thing a change to memory's search must keep. */
export type MemorySearch = (
  question: Pick<Question, 'question' | 'asked'>,
  limit: number,
) => Promise<Exchange[]>

/**
 * Memory's search as automatic recall runs it, over exchanges only: one
 * index over the Familiar's conversation with its journal lines as keys,
 * days the question names first, built on first use as after a restart.
 * When memory searches differently, this function is the one place to
 * change. Closing releases the store.
 */
export async function openMemorySearch(
  store: Pick<HistoryStore, 'path' | 'familiar'>,
  timeZone = EVAL_TIME_ZONE,
) {
  const harness = await Harness.open(
    await openNodeSqliteStorage(store.path),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  const view = memoryViews(
    harness,
    timeZone,
    BACKGROUND_CONTEXT,
  )(store.familiar)
  const search: MemorySearch = async ({ question, asked }, limit) => {
    await view.ready()
    return harness.commit(async (tx) => {
      await view.catchUp(tx)
      return view
        .search(question, {
          now: asked,
          limit,
          kind: 'exchange',
          ranges: datesIn(question, localDay(asked, timeZone)),
        })
        .flatMap((hit) => (hit.kind === 'exchange' ? [hit.exchange] : []))
    }, BACKGROUND_CONTEXT)
  }
  return { search, close: () => harness.close(BACKGROUND_CONTEXT) }
}

/** What an exchange covers in the release: every entry from its person message to the next. */
type Group = { sessions: Set<string>; hasAnswer: boolean }

/** Exchange ID to what it covers. Entries before the first person message belong to none. */
export function groupsOf(written: HistoryStore['written']) {
  const groups = new Map<string, Group>()
  let open: Group | undefined
  let orphanAnswer = false
  for (const entry of written) {
    if (entry.person) {
      open = { sessions: new Set(), hasAnswer: false }
      groups.set(`x${entry.entry}`, open)
    }
    if (!open) {
      // An assistant turn that opens the history joins no exchange, so no search finds it.
      orphanAnswer ||= entry.hasAnswer
      continue
    }
    open.sessions.add(entry.session)
    open.hasAnswer ||= entry.hasAnswer
  }
  return { groups, orphanAnswer }
}

/** How many of `needed` the top `k` of `ranked` cover, as hits. */
const covered = (
  needed: ReadonlySet<string>,
  ranked: readonly string[][],
  k: number,
) => {
  const seen = new Set(ranked.slice(0, k).flat())
  return [...needed].filter((unit) => seen.has(unit)).length
}

export type Level = {
  /** Evidence units there are to find. */
  needed: number
  /** Units found in the top k, for each k. */
  found: Record<number, number>
}

export type RetrievalScore = {
  question: string
  type: QuestionType
  /** The answer sessions, found by any exchange that covers part of one. */
  sessions: Level
  /** The exchanges with a labelled answer turn; absent when the release labels none. */
  turns?: Level
  /** Evidence sits in an opening assistant turn that no exchange holds. */
  unreachable: boolean
  searchMs: number
}

/** Scores `ranked` (best first) against the labels written with the history. */
export function scoreSearch(
  question: Pick<Question, 'id' | 'type' | 'sessions'>,
  written: HistoryStore['written'],
  ranked: readonly Exchange[],
  searchMs: number,
): RetrievalScore {
  const { groups, orphanAnswer } = groupsOf(written)
  const sessions = new Set(
    question.sessions.filter((s) => s.evidence).map((s) => s.id),
  )
  const answerGroups = new Set(
    [...groups].filter(([, group]) => group.hasAnswer).map(([id]) => id),
  )
  const top = ranked.map((exchange) => exchange.id)
  const ofSessions = ranked.map((exchange) => [
    ...(groups.get(exchange.id)?.sessions ?? []),
  ])
  const level = (needed: ReadonlySet<string>, units: readonly string[][]) => ({
    needed: needed.size,
    found: Object.fromEntries(
      KS.map((k) => [k, covered(needed, units, k)]),
    ) as Record<number, number>,
  })
  return {
    question: question.id,
    type: question.type,
    sessions: level(sessions, ofSessions),
    ...((answerGroups.size || orphanAnswer) && {
      turns: {
        ...level(
          answerGroups,
          top.map((id) => [id]),
        ),
        needed: answerGroups.size + Number(orphanAnswer),
      },
    }),
    unreachable: orphanAnswer,
    searchMs,
  }
}

export type Rate = {
  questions: number
  any: Record<number, number>
  all: Record<number, number>
}

/** recall_any (at least one unit found) and recall_all (every unit found) at each k, over `scores`. */
export function rateOf(
  scores: readonly RetrievalScore[],
  pick: (score: RetrievalScore) => Level | undefined,
): Rate {
  const levels = scores.flatMap((score) => pick(score) ?? [])
  const rate = (hit: (level: Level, k: number) => boolean) =>
    Object.fromEntries(
      KS.map((k) => [
        k,
        levels.length
          ? levels.filter((level) => hit(level, k)).length / levels.length
          : 0,
      ]),
    ) as Record<number, number>
  return {
    questions: levels.length,
    any: rate((level, k) => level.found[k] > 0),
    all: rate((level, k) => level.found[k] >= level.needed),
  }
}
