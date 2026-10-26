/**
 * The fact store and every rule about changing it. Tools, the owner's edits
 * and upkeep all go through these, so the rules live in one place. Each
 * function checks before it changes anything and throws when the change
 * isn't allowed, so a failed edit leaves memory as it was.
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
  /** Whether it sits in the prompt. Facts outside core are kept, not lost. */
  core: boolean
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

/** `remember` puts a fact this important or more in core while there is room. */
export const CORE_IMPORTANCE = 3

export const isPast = (fact: Fact) => fact.until !== undefined

/** The facts in the prompt, oldest first. */
export const coreFacts = (memory: MemoryState) =>
  memory.facts.filter((fact) => fact.core && !isPast(fact))

/** Facts as the model sees them; the core budget measures this. */
export const listFacts = (facts: Fact[]) =>
  facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')

/** How long core would be with `fact` in it. */
const coreWith = (memory: MemoryState, fact: Fact) =>
  listFacts([...coreFacts(memory).filter(({ id }) => id !== fact.id), fact])
    .length

const current = (memory: MemoryState, id: string) => {
  const fact = memory.facts.find((fact) => fact.id === id)
  if (!fact) throw new FactError(`No fact ${id}.`)
  if (isPast(fact))
    throw new FactError(`${id} is already past; only current facts can change.`)
  return fact
}

const importanceOf = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 5)
    throw new FactError('Importance must be a whole number from 1 to 5.')
  return value
}

/** Saves a fact, in core if it is important enough and fits. Never refuses for space. */
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
  fact.core =
    importance >= CORE_IMPORTANCE && coreWith(memory, fact) <= CORE_BUDGET
  memory.next++
  memory.facts.push(fact)
  return fact
}

/**
 * Saves a new version of a current fact, folding in any facts it `merges`;
 * they all become past, superseded by it. It takes the highest importance
 * among them and stays in core if any of them was and it still fits.
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
  const wasCore = olds.some((old) => old.core)
  for (const old of olds) {
    old.until = at
    old.core = false
  }
  fact.core = wasCore && coreWith(memory, fact) <= CORE_BUDGET
  memory.next++
  memory.facts.push(fact)
  return fact
}

/** Marks a current fact no longer true. It stays as history. */
export function retireFact(memory: MemoryState, id: string, at: number) {
  const fact = current(memory, id)
  fact.until = at
  fact.core = false
}

/** Puts a current fact in core or takes it out. Core never goes past its budget. */
export function setCore(memory: MemoryState, id: string, core: boolean) {
  const fact = current(memory, id)
  const size = coreWith(memory, fact)
  if (core && size > CORE_BUDGET)
    throw new FactError(
      `Core memory is full (${size} of ${CORE_BUDGET} characters with ${id}). Unpin something first.`,
    )
  fact.core = core
}

/** Records that facts reached the model. Facts forgotten meanwhile are skipped. */
export function markRecalled(memory: MemoryState, ids: string[], at: number) {
  for (const fact of memory.facts) if (ids.includes(fact.id)) fact.recalled = at
}

/** Deletes a fact outright, past or current. The only way a fact leaves the store. */
export function forgetFact(memory: MemoryState, id: string) {
  const index = memory.facts.findIndex((fact) => fact.id === id)
  if (index === -1) throw new FactError(`No fact ${id}.`)
  memory.facts.splice(index, 1)
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
