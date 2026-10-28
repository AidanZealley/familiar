import { defineDoc, type EntryId, type Tx } from '@earendil-works/pi-durable'
import { formatDay, parseDay } from '../time/index.ts'

/**
 * The fact store and every rule about changing it. Upkeep's tools and the
 * owner's edits all go through these, so the rules live in one place. Each
 * function checks before it changes anything and throws when the change
 * isn't allowed, so a failed edit leaves memory as it was. Which facts are
 * in core is decided only by `rebalanceCore`, which every edit ends with.
 * No rule deletes a fact: the transcript it came from can't be erased
 * either, so retiring is the honest way to say it no longer holds.
 */

/** A change the rules don't allow, such as revising a missing or past fact. */
export class FactError extends Error {}

/**
 * A fact is one statement this long at most. Without a cap, merging makes
 * facts grow, core holds fewer each year, and long facts match searches
 * they aren't about.
 */
export const FACT_LIMIT = 300

export type Fact = {
  /** `f1`, `f2`, …: short enough for the model to quote. Never reused. */
  id: string
  /** One statement, at most FACT_LIMIT characters. */
  text: string
  /** 1 to 5: 5 for identity, close people, health and standing commitments; 1 for minor preferences. */
  importance: number
  /** The local day it became true, `YYYY-MM-DD`: world time, not when it was saved. */
  since: string
  /** The local day it stopped being true. A fact with `until` is past: kept as history, never in the prompt. */
  until?: string
  /** Entry IDs of the person messages it came from. Empty only for seeded and owner-written facts. */
  sources: EntryId[]
  /** When upkeep or the owner wrote it, in ms since the epoch: record time. */
  saved: number
  /** The facts this one superseded: one for a correction, several for a merge. */
  replaces?: string[]
  /** Whether it sits in the prompt now. Facts outside core are kept, not lost, and recalled when relevant. */
  core: boolean
  /** The owner wants it in core: rebalancing places it first. */
  pinned?: boolean
}

export type FactsState = {
  facts: Fact[]
  /** Next fact number. */
  next: number
}

/** When each fact was last used and checked, in ms. Kept apart so facts change only when facts do. */
export type UsageState = {
  facts: Record<string, { recalled?: number; checked?: number }>
}

/** The two documents every rule reads: facts, and how they've been used. */
export type Memory = { facts: FactsState; usage: UsageState }

/**
 * What Familiar knows about the people it helps. One document for the whole
 * Familiar, stored with the transcript, and streamed to clients as `memory`.
 */
export const Facts = defineDoc<FactsState>({
  kind: 'familiar.facts',
  version: 1,
  scope: 'session',
  initial: () => ({ facts: [], next: 1 }),
  // Store a full copy now and then, so reading it never replays a long history.
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

/**
 * When facts last reached the model and were last checked by upkeep. These
 * change on nearly every reply, so they live apart from the facts clients
 * receive, and aren't streamed.
 */
export const MemoryUsage = defineDoc<UsageState>({
  kind: 'familiar.memory-usage',
  version: 1,
  scope: 'session',
  initial: () => ({ facts: {} }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

/** Both memory documents, for a transaction that changes facts. */
export const openMemory = async (tx: Tx): Promise<Memory> => ({
  facts: await tx.doc(Facts),
  usage: await tx.doc(MemoryUsage),
})

/** Core is at most this many characters as the model sees it, so the prompt stays small however long Familiar runs. */
export const CORE_BUDGET = 6_000

/** Facts this important or more are in core while there is room. */
export const CORE_IMPORTANCE = 3

/**
 * A fact outside core displaces an equally important one inside only if it
 * was used this much more recently, so core doesn't flip back and forth.
 */
export const CORE_STICKINESS = 14 * 24 * 60 * 60 * 1000

export const isPast = (fact: Fact) => fact.until !== undefined

/** The facts in the prompt, oldest first. */
export const coreFacts = (facts: FactsState) =>
  facts.facts.filter((fact) => fact.core && !isPast(fact))

/** Facts as the model sees them; the core budget measures this. */
export const listFacts = (facts: Fact[]) =>
  facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')

/** The fact that superseded a past one, if any. */
export const successorOf = (facts: FactsState, fact: Fact) =>
  facts.facts.find((other) => other.replaces?.includes(fact.id))

/**
 * A fact's days as recall and upkeep show them: `since 2025-11-03`, or
 * `2025-02-02 to 2025-11-03, replaced by f40` once past. Never its record
 * time, so a fact filed late can't claim it became true the night it was filed.
 */
export function factDays(facts: FactsState, fact: Fact) {
  if (!isPast(fact)) {
    return `since ${fact.since}`
  }
  const successor = successorOf(facts, fact)
  return `${fact.since} to ${fact.until}, ${successor ? `replaced by ${successor.id}` : 'no longer current'}`
}

const current = (facts: FactsState, id: string) => {
  const fact = facts.facts.find((fact) => fact.id === id)
  if (!fact) {
    throw new FactError(`No fact ${id}.`)
  }
  if (isPast(fact)) {
    throw new FactError(`${id} is already past; only current facts can change.`)
  }
  return fact
}

const importanceOf = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new FactError('Importance must be a whole number from 1 to 5.')
  }
  return value
}

const textOf = (value: string) => {
  const text = value.trim()
  if (!text) {
    throw new FactError('A fact needs text.')
  }
  if (text.length > FACT_LIMIT) {
    throw new FactError(
      `A fact is at most ${FACT_LIMIT} characters and this is ${text.length}. Split it into separate facts, one statement each.`,
    )
  }
  return text
}

/** A real local day, `YYYY-MM-DD`. */
export const dayOf = (value: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    formatDay(parseDay(value)) !== value
  ) {
    throw new FactError(`${value} is not a day; write it as YYYY-MM-DD.`)
  }
  return value
}

export type NewFact = {
  text: string
  importance: number
  since: string
  sources: EntryId[]
}

/** Saves a fact, in core if it ranks high enough. Never refuses for space. */
export function rememberFact(
  memory: Memory,
  { text, importance, since, sources }: NewFact,
  saved: number,
): Fact {
  const { facts } = memory
  const fact: Fact = {
    id: `f${facts.next}`,
    text: textOf(text),
    importance: importanceOf(importance),
    since: dayOf(since),
    sources: [...new Set(sources)],
    saved,
    core: false,
  }
  facts.next++
  facts.facts.push(fact)
  rebalanceCore(memory)
  return fact
}

export type Revision = {
  text: string
  since: string
  sources?: EntryId[]
  /** Defaults to the highest importance among the facts it replaces. */
  importance?: number
  /** Other current facts the new text also covers. */
  merge?: string[]
}

/**
 * Saves a new version of a current fact, folding in any facts it `merge`s;
 * they all become past, ending when the new version begins. It keeps all
 * their sources, and their pin if it still fits among the other pins.
 */
export function reviseFact(
  memory: Memory,
  id: string,
  { text, since, sources = [], importance, merge = [] }: Revision,
  saved: number,
): Fact {
  const { facts } = memory
  const ids = [...new Set([id, ...merge])]
  const olds = ids.map((id) => current(facts, id))
  const fact: Fact = {
    id: `f${facts.next}`,
    text: textOf(text),
    importance:
      importance === undefined
        ? Math.max(...olds.map((old) => old.importance))
        : importanceOf(importance),
    since: dayOf(since),
    sources: [...new Set([...sources, ...olds.flatMap((old) => old.sources)])],
    saved,
    replaces: ids,
    core: false,
  }
  const wasPinned = olds.some((old) => old.pinned)
  for (const old of olds) {
    // A correction can date the new version before the old one began; an
    // old fact never ends before it started.
    old.until = fact.since < old.since ? old.since : fact.since
    delete old.pinned
  }
  // A version too long to fit among the other pins stays current, unpinned.
  if (wasPinned && pinnedSize(facts, fact) <= CORE_BUDGET) {
    fact.pinned = true
  }
  facts.next++
  facts.facts.push(fact)
  rebalanceCore(memory)
  return fact
}

/** Marks a current fact no longer true from `until`. It stays as history. */
export function retireFact(memory: Memory, id: string, until: string) {
  const fact = current(memory.facts, id)
  const day = dayOf(until)
  fact.until = day < fact.since ? fact.since : day
  delete fact.pinned
  rebalanceCore(memory)
}

/** How long the pinned facts are as the model sees them, with `extra` among them. */
const pinnedSize = (facts: FactsState, extra: Fact) =>
  listFacts([
    ...facts.facts.filter(
      (fact) => fact.pinned && !isPast(fact) && fact.id !== extra.id,
    ),
    extra,
  ]).length

/**
 * Pins a current fact into core, or unpins it so ranking decides. Unpinned
 * facts make room for pinned ones, so pinning refuses only when the pinned
 * facts alone would pass core's budget.
 */
export function setPinned(memory: Memory, id: string, pinned: boolean) {
  const fact = current(memory.facts, id)
  if (pinned) {
    const size = pinnedSize(memory.facts, fact)
    if (size > CORE_BUDGET) {
      throw new FactError(
        `Pinned facts would fill ${size} of core's ${CORE_BUDGET} characters. Unpin something first.`,
      )
    }
    fact.pinned = true
  } else {
    delete fact.pinned
  }
  rebalanceCore(memory)
}

/**
 * Decides core within its budget: pinned facts first, then facts important
 * enough for core, most important first and, among equals, most recently
 * used. Plain code rather than a model decision, so core can't drift. Moves
 * facts in and out of core; never removes one.
 */
export function rebalanceCore({ facts, usage }: Memory) {
  // When it last mattered: written, or recalled in conversation. Core facts
  // get a head start, see CORE_STICKINESS.
  const standing = (fact: Fact) =>
    Math.max(fact.saved, usage.facts[fact.id]?.recalled ?? 0) +
    (fact.core ? CORE_STICKINESS : 0)
  const candidates = facts.facts
    .filter(
      (fact) =>
        !isPast(fact) && (fact.pinned || fact.importance >= CORE_IMPORTANCE),
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        b.importance - a.importance ||
        standing(b) - standing(a),
    )
  const chosen = new Set<string>()
  let size = 0
  for (const fact of candidates) {
    const line = listFacts([fact]).length + (chosen.size ? 1 : 0)
    if (size + line > CORE_BUDGET) {
      continue
    }
    chosen.add(fact.id)
    size += line
  }
  for (const fact of facts.facts) {
    const core = chosen.has(fact.id)
    // Only real changes, so an unchanged core commits nothing.
    if (fact.core !== core) {
      fact.core = core
    }
  }
}

/** Records that facts reached the conversation model, for recency. */
export function markRecalled(usage: UsageState, ids: string[], at: number) {
  for (const id of ids) {
    usage.facts[id] = { ...usage.facts[id], recalled: at }
  }
}
