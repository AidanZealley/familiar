import { expect, test } from 'vitest'
import {
  CORE_BUDGET,
  CORE_STICKINESS,
  coreFacts,
  FactError,
  forgetFact,
  listFacts,
  migrateV1,
  rememberFact,
  retireFact,
  reviseFact,
  rebalanceCore,
  setImportance,
  setPinned,
  type MemoryState,
} from './facts.ts'

const empty = (): MemoryState => ({ facts: [], next: 1 })

/** Memory with `count` important facts of about 100 characters each. */
const full = (count: number) => {
  const memory = empty()
  for (let index = 0; index < count; index++)
    rememberFact(memory, `Fact ${index}: ${'worth keeping '.repeat(6)}`, 4, 1)
  return memory
}

test('remember puts important facts in core and minor ones outside it', () => {
  const memory = empty()
  const important = rememberFact(memory, 'Lives in Leeds', 3, 10)
  const minor = rememberFact(memory, 'Likes blue pens', 1, 20)
  expect(important).toEqual({
    id: 'm1',
    text: 'Lives in Leeds',
    at: 10,
    created: 10,
    importance: 3,
    core: true,
  })
  expect(minor).toMatchObject({ id: 'm2', importance: 1, core: false })
  expect(memory.next).toBe(3)
})

test('beyond core budget, remember keeps the fact outside core instead of refusing', () => {
  const memory = full(80)
  expect(memory.facts).toHaveLength(80)
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)
  expect(memory.facts.at(-1)?.core).toBe(false)
  // More important than everything in core, so it takes a place there.
  const essential = rememberFact(
    memory,
    `Allergic to penicillin: ${'details '.repeat(25)}`,
    5,
    2,
  )
  expect(essential.core).toBe(true)
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)
  expect(memory.facts).toHaveLength(81)
})

test('importance outside 1 to 5 is refused without changing memory', () => {
  const memory = empty()
  for (const importance of [0, 6, 2.5])
    expect(() => rememberFact(memory, 'Text', importance, 1)).toThrow(FactError)
  expect(memory).toEqual(empty())
})

test('revising saves a new version and keeps the old one as past', () => {
  const memory = empty()
  rememberFact(memory, 'Lives in Leeds', 4, 10)
  rememberFact(memory, 'Has a cat', 2, 10)
  const york = reviseFact(memory, 'm1', 'Lives in York', 20)
  const sheffield = reviseFact(memory, york.id, 'Lives in Sheffield', 30)
  expect(memory.facts).toEqual([
    expect.objectContaining({ id: 'm1', until: 20, core: false }),
    expect.objectContaining({ id: 'm2', text: 'Has a cat' }),
    expect.objectContaining({
      id: 'm3',
      text: 'Lives in York',
      replaces: ['m1'],
      until: 30,
      core: false,
    }),
    {
      id: 'm4',
      text: 'Lives in Sheffield',
      at: 30,
      created: 30,
      importance: 4,
      core: true,
      replaces: ['m3'],
    },
  ])
  expect(sheffield.id).toBe('m4')
  expect(coreFacts(memory).map((fact) => fact.id)).toEqual(['m4'])
})

test('a revision too long for core stays current outside it', () => {
  const memory = full(55)
  const first = memory.facts[0]
  const revised = reviseFact(memory, first.id, 'x'.repeat(CORE_BUDGET), 2)
  expect(revised.core).toBe(false)
  expect(revised.until).toBeUndefined()
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)
})

test('merging supersedes every merged fact with one new version', () => {
  const memory = empty()
  rememberFact(memory, 'Has a cat', 2, 10)
  rememberFact(memory, 'Owns a cat called Miso', 4, 10)
  const merged = reviseFact(memory, 'm2', 'Owns a cat called Miso', 20, [
    'm1',
    'm2',
  ])
  expect(merged).toMatchObject({
    id: 'm3',
    importance: 4,
    core: true,
    replaces: ['m2', 'm1'],
  })
  expect(memory.facts.slice(0, 2)).toMatchObject([
    { id: 'm1', until: 20 },
    { id: 'm2', until: 20 },
  ])
  expect(() => reviseFact(memory, 'm3', 'Two cats', 30, ['m9'])).toThrow(
    'No fact m9',
  )
  expect(memory.facts).toHaveLength(3)
})

test('retiring keeps the fact as past history', () => {
  const memory = empty()
  rememberFact(memory, 'Works at Northbank', 4, 10)
  retireFact(memory, 'm1', 20)
  expect(memory.facts).toEqual([
    expect.objectContaining({ id: 'm1', until: 20, core: false }),
  ])
  expect(coreFacts(memory)).toEqual([])
})

test('past and missing facts cannot change, and nothing is touched trying', () => {
  const memory = empty()
  rememberFact(memory, 'Old job', 3, 10)
  retireFact(memory, 'm1', 20)
  const before = structuredClone(memory)
  expect(() => reviseFact(memory, 'm1', 'New', 30)).toThrow('already past')
  expect(() => retireFact(memory, 'm1', 30)).toThrow('already past')
  expect(() => setPinned(memory, 'm1', true)).toThrow('already past')
  expect(() => setImportance(memory, 'm1', 5)).toThrow('already past')
  expect(() => reviseFact(memory, 'm9', 'New', 30)).toThrow('No fact m9')
  expect(() => forgetFact(memory, 'm9')).toThrow('No fact m9')
  expect(memory).toEqual(before)
})

test('unpinned facts make room for pins, which refuse only past the budget', () => {
  const memory = full(80)
  const outside = memory.facts.find((fact) => !fact.core)!
  setPinned(memory, outside.id, true)
  expect(outside).toMatchObject({ core: true, pinned: true })
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)

  // Pin everything: once pins alone would overflow core, pinning refuses.
  let refused = 0
  for (const fact of memory.facts) {
    const before = structuredClone(memory)
    try {
      setPinned(memory, fact.id, true)
    } catch (error) {
      expect(String(error)).toContain('Pinned facts would fill')
      expect(memory).toEqual(before)
      refused++
    }
  }
  expect(refused).toBeGreaterThan(0)
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)
  setPinned(memory, outside.id, false)
  expect(outside.pinned).toBeUndefined()
})

test('a revision too long to stay pinned stays current, unpinned', () => {
  const memory = full(55)
  for (const fact of memory.facts) setPinned(memory, fact.id, true)
  const revised = reviseFact(memory, 'm1', 'x'.repeat(2_000), 2)
  expect(revised.pinned).toBeUndefined()
  expect(revised.until).toBeUndefined()
  // Every other pin is still in core.
  expect(
    memory.facts.filter((fact) => fact.pinned).every((fact) => fact.core),
  ).toBe(true)
})

test('rebalancing fills core by importance, then recency, within budget', () => {
  const memory = full(80)
  // Minor facts never enter core unless pinned.
  const minor = rememberFact(memory, 'Likes blue pens', 1, 5)
  // A fact recalled well after core's facts were last used takes a place;
  // CORE_STICKINESS keeps one recalled about as recently from flipping core.
  const outside = memory.facts.filter((fact) => !fact.core)
  const recalled = outside[0]
  recalled.recalled = 2 + CORE_STICKINESS
  const recent = outside[1]
  recent.recalled = CORE_STICKINESS - 1
  // An essential fact beats every importance-4 fact.
  const essential = memory.facts.at(-2)!
  setImportance(memory, essential.id, 5)
  const count = memory.facts.length
  rebalanceCore(memory)
  expect(memory.facts).toHaveLength(count)
  expect(listFacts(coreFacts(memory)).length).toBeLessThanOrEqual(CORE_BUDGET)
  expect(minor.core).toBe(false)
  expect(recalled.core).toBe(true)
  expect(recent.core).toBe(false)
  expect(essential.core).toBe(true)
  // Past facts never return to core.
  retireFact(memory, essential.id, 20)
  rebalanceCore(memory)
  expect(essential.core).toBe(false)
})

test('forget removes a fact, past or current, without reusing its number', () => {
  const memory = empty()
  rememberFact(memory, 'Lives in Leeds', 3, 10)
  reviseFact(memory, 'm1', 'Lives in York', 20)
  forgetFact(memory, 'm1')
  forgetFact(memory, 'm2')
  expect(memory).toEqual({ facts: [], next: 3 })
})

test('no change other than forget removes a fact', () => {
  const memory = empty()
  rememberFact(memory, 'A', 3, 1)
  rememberFact(memory, 'B', 1, 1)
  rememberFact(memory, 'C', 5, 1)
  const ids = () => memory.facts.map((fact) => fact.id)
  const kept = ids()
  reviseFact(memory, 'm1', 'A2', 2)
  retireFact(memory, 'm2', 2)
  setPinned(memory, 'm3', true)
  setPinned(memory, 'm3', false)
  setImportance(memory, 'm3', 1)
  rebalanceCore(memory)
  expect(ids()).toEqual([...kept, 'm4'])
})

test('version 1 facts migrate into core with ordinary importance', () => {
  expect(
    migrateV1({ facts: [{ id: 'm1', text: 'Uses pnpm', at: 10 }], next: 2 }),
  ).toEqual({
    facts: [
      {
        id: 'm1',
        text: 'Uses pnpm',
        at: 10,
        created: 10,
        importance: 3,
        core: true,
      },
    ],
    next: 2,
  })
})
