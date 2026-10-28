import { defineDoc } from '@earendil-works/pi-durable'

/**
 * The fact store and every rule about changing it. Tools, the owner's edits
 * and upkeep all go through these, so the rules live in one place. Each
 * function checks before it changes anything and throws when the change
 * isn't allowed, so a failed edit leaves memory as it was. Which facts are
 * in core is decided only by `rebalanceCore`, which every edit ends with.
 */

/** A change the rules don't allow, such as revising a missing or past fact. */
export class FactError extends Error {}

export type Fact = {
  /** `m1`, `m2`, …: short enough for the model to quote. Never reused. */
  id: string
  text: string
  /** When it was last written, in ms since the epoch. */
  at: number
  created: number
  /** 1 to 5, rated by the model: 5 for identity, close people, health and standing commitments; 1 for minor preferences. */
  importance: number
  /** Whether it sits in the prompt now. Facts outside core are kept, not lost, and recalled when relevant. */
  core: boolean
  /** The owner wants it in core: rebalancing places it first. */
  pinned?: boolean
  /** When it stopped being true. A fact with `until` is past: kept as history, never in the prompt. */
  until?: number
  /**
   * The facts this one superseded, so changes form a chain: one for a
   * correction, several for a merge. They may since have been forgotten.
   */
  replaces?: string[]
  /** When it last reached the model, for recency. */
  recalled?: number
}

export type MemoryState = {
  facts: Fact[]
  /** Next fact number. */
  next: number
}

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
export const coreFacts = (memory: MemoryState) =>
  memory.facts.filter((fact) => fact.core && !isPast(fact))

/** Facts as the model sees them; the core budget measures this. */
export const listFacts = (facts: Fact[]) =>
  facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')

const current = (memory: MemoryState, id: string) => {
  const fact = memory.facts.find((fact) => fact.id === id)
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

/** Saves a fact, in core if it ranks high enough. Never refuses for space. */
export function rememberFact(
  memory: MemoryState,
  text: string,
  importance: number,
  at: number,
): Fact {
  const fact: Fact = {
    id: `m${memory.next}`,
    text,
    at,
    created: at,
    importance: importanceOf(importance),
    core: false,
  }
  memory.next++
  memory.facts.push(fact)
  rebalanceCore(memory)
  return fact
}

/**
 * Saves a new version of a current fact, folding in any facts it `merges`;
 * they all become past, superseded by it. It takes the highest importance
 * among them, and their pin if it still fits among the other pins.
 */
export function reviseFact(
  memory: MemoryState,
  id: string,
  text: string,
  at: number,
  merges: string[] = [],
): Fact {
  const ids = [...new Set([id, ...merges])]
  const olds = ids.map((id) => current(memory, id))
  const fact: Fact = {
    id: `m${memory.next}`,
    text,
    at,
    created: at,
    importance: Math.max(...olds.map((old) => old.importance)),
    core: false,
    replaces: ids,
  }
  const wasPinned = olds.some((old) => old.pinned)
  for (const old of olds) {
    old.until = at
    delete old.pinned
  }
  // A version too long to fit among the other pins stays current, unpinned.
  if (wasPinned && pinnedSize(memory, fact) <= CORE_BUDGET) {
    fact.pinned = true
  }
  memory.next++
  memory.facts.push(fact)
  rebalanceCore(memory)
  return fact
}

/** Marks a current fact no longer true. It stays as history. */
export function retireFact(memory: MemoryState, id: string, at: number) {
  const fact = current(memory, id)
  fact.until = at
  delete fact.pinned
  rebalanceCore(memory)
}

/** How long the pinned facts are as the model sees them, with `extra` among them. */
const pinnedSize = (memory: MemoryState, extra: Fact) =>
  listFacts([
    ...memory.facts.filter(
      (fact) => fact.pinned && !isPast(fact) && fact.id !== extra.id,
    ),
    extra,
  ]).length

/**
 * Pins a current fact into core, or unpins it so ranking decides. Unpinned
 * facts make room for pinned ones, so pinning refuses only when the pinned
 * facts alone would pass core's budget.
 */
export function setPinned(memory: MemoryState, id: string, pinned: boolean) {
  const fact = current(memory, id)
  if (pinned) {
    const size = pinnedSize(memory, fact)
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

/** Re-rates how much a current fact matters, which decides its place in core. */
export function setImportance(
  memory: MemoryState,
  id: string,
  importance: number,
) {
  current(memory, id).importance = importanceOf(importance)
  rebalanceCore(memory)
}

/** When it last mattered: written, or recalled in conversation. Core facts get a head start, see CORE_STICKINESS. */
const standing = (fact: Fact) =>
  Math.max(fact.at, fact.recalled ?? 0) + (fact.core ? CORE_STICKINESS : 0)

/**
 * Decides core within its budget: pinned facts first, then facts important
 * enough for core, most important first and, among equals, most recently
 * used. Plain code rather than a model decision, so core can't drift. Moves
 * facts in and out of core; never removes one.
 */
export function rebalanceCore(memory: MemoryState) {
  const candidates = memory.facts
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
  for (const fact of memory.facts) {
    const core = chosen.has(fact.id)
    // Only real changes, so an unchanged core commits nothing.
    if (fact.core !== core) {
      fact.core = core
    }
  }
}

/** Records that facts reached the model. Facts forgotten meanwhile are skipped. */
export function markRecalled(memory: MemoryState, ids: string[], at: number) {
  for (const fact of memory.facts) {
    if (ids.includes(fact.id)) {
      fact.recalled = at
    }
  }
}

/** Deletes a fact outright, past or current. The only way a fact leaves the store. */
export function forgetFact(memory: MemoryState, id: string) {
  const index = memory.facts.findIndex((fact) => fact.id === id)
  if (index === -1) {
    throw new FactError(`No fact ${id}.`)
  }
  memory.facts.splice(index, 1)
  rebalanceCore(memory)
}

/** Version 1 facts were all in the prompt, so they all start in core. */
export function migrateV1(value: {
  facts: { id: string; text: string; at: number }[]
  next: number
}): MemoryState {
  return {
    next: value.next,
    facts: value.facts.map((fact) => ({
      ...fact,
      created: fact.at,
      importance: CORE_IMPORTANCE,
      core: true,
    })),
  }
}

/**
 * What Familiar knows about the people it helps. One document for the whole
 * Familiar (every conversation shares it), stored with the transcript, so a
 * fact and the reply that mentions it are committed together.
 */
export const Memory = defineDoc<MemoryState>({
  kind: 'familiar.memory',
  version: 2,
  scope: 'session',
  initial: () => ({ facts: [], next: 1 }),
  migrate: (value, fromVersion) => {
    if (fromVersion !== 1) {
      throw new Error(`No migration from memory version ${fromVersion}.`)
    }
    return migrateV1(value as Parameters<typeof migrateV1>[0])
  },
  // Store a full copy now and then, so reading it never replays a long history.
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})
