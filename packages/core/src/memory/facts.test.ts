import type { EntryId } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import {
  CORE_BUDGET,
  CORE_STICKINESS,
  coreFacts,
  dueForReview,
  FACT_LIMIT,
  FactError,
  factDays,
  listFacts,
  markChecked,
  markRecalled,
  REVIEW_LIMIT,
  rememberFact,
  retireFact,
  reviseFact,
  rebalanceCore,
  setPinned,
  type Memory,
} from './facts.ts'

const empty = (): Memory => ({
  facts: { facts: [], next: 1 },
  usage: { facts: {} },
})

const source = (id: number) => id as EntryId

/** Saves a fact true since `since`, from message `from`. */
const save = (
  memory: Memory,
  text: string,
  importance: number,
  saved = 1,
  since = '2025-01-01',
  from?: number,
) =>
  rememberFact(
    memory,
    { text, importance, since, sources: from ? [source(from)] : [] },
    saved,
  )

/** Memory with `count` important facts of about 100 characters each. */
const full = (count: number) => {
  const memory = empty()
  for (let index = 0; index < count; index++) {
    save(memory, `Fact ${index}: ${'worth keeping '.repeat(6)}`, 4)
  }
  return memory
}

const coreSize = (memory: Memory) => listFacts(coreFacts(memory.facts)).length

test('remember puts important facts in core and minor ones outside it', () => {
  const memory = empty()
  const important = save(memory, ' Lives in Leeds ', 3, 10, '2025-01-06', 4)
  const minor = save(memory, 'Likes blue pens', 1, 20)
  expect(important).toEqual({
    id: 'f1',
    text: 'Lives in Leeds',
    importance: 3,
    since: '2025-01-06',
    sources: [4],
    saved: 10,
    core: true,
  })
  expect(minor).toMatchObject({ id: 'f2', importance: 1, core: false })
  expect(memory.facts.next).toBe(3)
})

test('beyond core budget, remember keeps the fact outside core instead of refusing', () => {
  const memory = full(80)
  expect(memory.facts.facts).toHaveLength(80)
  expect(coreSize(memory)).toBeLessThanOrEqual(CORE_BUDGET)
  expect(memory.facts.facts.at(-1)?.core).toBe(false)
  // More important than everything in core, so it takes a place there.
  const essential = save(memory, 'Allergic to penicillin', 5, 2)
  expect(essential.core).toBe(true)
  expect(coreSize(memory)).toBeLessThanOrEqual(CORE_BUDGET)
  expect(memory.facts.facts).toHaveLength(81)
})

test('text, importance and days are checked without changing memory', () => {
  const memory = empty()
  for (const importance of [0, 6, 2.5]) {
    expect(() => save(memory, 'Text', importance)).toThrow(FactError)
  }
  expect(() => save(memory, '  ', 2)).toThrow('needs text')
  for (const since of ['2025-02-30', '2025-1-1', 'yesterday']) {
    expect(() => save(memory, 'Text', 2, 1, since)).toThrow('not a day')
  }
  expect(memory).toEqual(empty())
})

test('a fact over the length cap is refused with advice to split it', () => {
  const memory = empty()
  save(memory, 'x'.repeat(FACT_LIMIT), 2)
  expect(() => save(memory, 'x'.repeat(FACT_LIMIT + 1), 2)).toThrow(
    /at most 300 characters.*Split it into separate facts/,
  )
  expect(() =>
    reviseFact(
      memory,
      'f1',
      { text: 'y'.repeat(FACT_LIMIT + 1), since: '2025-02-01' },
      2,
    ),
  ).toThrow('Split it')
  expect(memory.facts.facts).toHaveLength(1)
  expect(memory.facts.facts[0].until).toBeUndefined()
})

test('revising ends the old version on the day the new one begins, carrying its sources', () => {
  const memory = empty()
  save(memory, 'Lives in Leeds', 4, 10, '2025-01-06', 1)
  save(memory, 'Has a cat', 2, 10)
  const york = reviseFact(
    memory,
    'f1',
    { text: 'Lives in York', since: '2025-02-02', sources: [source(5)] },
    20,
  )
  const sheffield = reviseFact(
    memory,
    york.id,
    { text: 'Lives in Sheffield', since: '2025-07-01', sources: [source(9)] },
    30,
  )
  expect(memory.facts.facts).toEqual([
    expect.objectContaining({ id: 'f1', until: '2025-02-02', core: false }),
    expect.objectContaining({ id: 'f2', text: 'Has a cat' }),
    expect.objectContaining({
      id: 'f3',
      replaces: ['f1'],
      since: '2025-02-02',
      until: '2025-07-01',
      sources: [5, 1],
      core: false,
    }),
    {
      id: 'f4',
      text: 'Lives in Sheffield',
      importance: 4,
      since: '2025-07-01',
      sources: [9, 5, 1],
      saved: 30,
      replaces: ['f3'],
      core: true,
    },
  ])
  expect(sheffield.id).toBe('f4')
  expect(coreFacts(memory.facts).map((fact) => fact.id)).toEqual(['f4'])
  expect(factDays(memory.facts, memory.facts.facts[0])).toBe(
    '2025-01-06 to 2025-02-02, replaced by f3',
  )
  expect(factDays(memory.facts, sheffield)).toBe('since 2025-07-01')
})

test('a revision dated before the old fact began never ends it before it started', () => {
  const memory = empty()
  save(memory, 'Birthday is 4 May', 3, 1, '2025-03-01')
  reviseFact(
    memory,
    'f1',
    { text: 'Birthday is 5 May', since: '2025-01-01', importance: 5 },
    2,
  )
  expect(memory.facts.facts[0].until).toBe('2025-03-01')
  expect(memory.facts.facts[1]).toMatchObject({ importance: 5 })
})

test('merging supersedes every merged fact with one new version', () => {
  const memory = empty()
  save(memory, 'Has a cat', 2, 10, '2025-01-01', 1)
  save(memory, 'Owns a cat called Miso', 4, 10, '2025-01-01', 2)
  const merged = reviseFact(
    memory,
    'f2',
    {
      text: 'Owns a cat called Miso',
      since: '2025-03-01',
      merge: ['f1', 'f2'],
    },
    20,
  )
  expect(merged).toMatchObject({
    id: 'f3',
    importance: 4,
    core: true,
    replaces: ['f2', 'f1'],
    sources: [2, 1],
  })
  expect(memory.facts.facts.slice(0, 2)).toMatchObject([
    { id: 'f1', until: '2025-03-01' },
    { id: 'f2', until: '2025-03-01' },
  ])
  expect(() =>
    reviseFact(
      memory,
      'f3',
      { text: 'Two cats', since: '2025-04-01', merge: ['f9'] },
      30,
    ),
  ).toThrow('No fact f9')
  expect(memory.facts.facts).toHaveLength(3)
})

test('retiring keeps the fact as past history, ending on the given day', () => {
  const memory = empty()
  save(memory, 'Works at Northbank', 4, 10, '2025-01-06')
  retireFact(memory, 'f1', '2025-02-09')
  expect(memory.facts.facts).toEqual([
    expect.objectContaining({ id: 'f1', until: '2025-02-09', core: false }),
  ])
  expect(coreFacts(memory.facts)).toEqual([])
  expect(factDays(memory.facts, memory.facts.facts[0])).toBe(
    '2025-01-06 to 2025-02-09, no longer current',
  )
})

test('retiring before a fact began ends it the day it began', () => {
  const memory = empty()
  save(memory, 'Works at Lantern Museum', 4, 10, '2025-03-01')
  retireFact(memory, 'f1', '2025-01-01')
  expect(memory.facts.facts[0].until).toBe('2025-03-01')
})

test('past and missing facts cannot change, and nothing is touched trying', () => {
  const memory = empty()
  save(memory, 'Old job', 3)
  retireFact(memory, 'f1', '2025-02-01')
  const before = structuredClone(memory)
  const revision = { text: 'New', since: '2025-03-01' }
  expect(() => reviseFact(memory, 'f1', revision, 30)).toThrow('already past')
  expect(() => retireFact(memory, 'f1', '2025-03-01')).toThrow('already past')
  expect(() => setPinned(memory, 'f1', true)).toThrow('already past')
  expect(() => reviseFact(memory, 'f9', revision, 30)).toThrow('No fact f9')
  expect(memory).toEqual(before)
})

test('unpinned facts make room for pins, which refuse only past the budget', () => {
  const memory = full(80)
  const outside = memory.facts.facts.find((fact) => !fact.core)!
  setPinned(memory, outside.id, true)
  expect(outside).toMatchObject({ core: true, pinned: true })
  expect(coreSize(memory)).toBeLessThanOrEqual(CORE_BUDGET)

  // Pin everything: once pins alone would overflow core, pinning refuses.
  let refused = 0
  for (const fact of memory.facts.facts) {
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
  expect(coreSize(memory)).toBeLessThanOrEqual(CORE_BUDGET)
  setPinned(memory, outside.id, false)
  expect(outside.pinned).toBeUndefined()
})

test('a revision too long to stay pinned stays current, unpinned', () => {
  // Pin until core is too full for another fact.
  const memory = full(70)
  for (const fact of memory.facts.facts) {
    try {
      setPinned(memory, fact.id, true)
    } catch {
      break
    }
  }
  const revised = reviseFact(
    memory,
    'f1',
    { text: 'x'.repeat(FACT_LIMIT), since: '2025-02-01' },
    2,
  )
  expect(revised.pinned).toBeUndefined()
  expect(revised.until).toBeUndefined()
  // Every other pin is still in core.
  expect(
    memory.facts.facts.filter((fact) => fact.pinned).every((fact) => fact.core),
  ).toBe(true)
})

test('rebalancing fills core by importance, then recent use, within budget', () => {
  const memory = full(80)
  // Minor facts never enter core unless pinned.
  const minor = save(memory, 'Likes blue pens', 1, 5)
  // A fact recalled well after core's facts were last used takes a place;
  // CORE_STICKINESS keeps one recalled about as recently from flipping core.
  const outside = memory.facts.facts.filter((fact) => !fact.core)
  const recalled = outside[0]
  markRecalled(memory.usage, [recalled.id], 2 + CORE_STICKINESS)
  const recent = outside[1]
  markRecalled(memory.usage, [recent.id], CORE_STICKINESS - 1)
  // An essential fact beats every importance-4 fact.
  const essential = save(memory, 'Allergic to penicillin', 5)
  const count = memory.facts.facts.length
  rebalanceCore(memory)
  expect(memory.facts.facts).toHaveLength(count)
  expect(coreSize(memory)).toBeLessThanOrEqual(CORE_BUDGET)
  expect(minor.core).toBe(false)
  expect(recalled.core).toBe(true)
  expect(recent.core).toBe(false)
  expect(essential.core).toBe(true)
  // Past facts never return to core.
  retireFact(memory, essential.id, '2025-06-01')
  rebalanceCore(memory)
  expect(essential.core).toBe(false)
})

test('review picks current facts unchecked longest, oldest first, up to the limit', () => {
  const memory = empty()
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_000 * DAY
  for (let index = 0; index < REVIEW_LIMIT + 5; index++) {
    save(memory, `Fact ${index}`, 2, now - (100 + index) * DAY)
  }
  // Checked recently: not due, however old.
  markChecked(memory.usage, ['f25'], now - 10 * DAY)
  // Checked long ago, but after it was saved: due, ahead of newer saves.
  markChecked(memory.usage, ['f1'], now - 110.5 * DAY)
  retireFact(memory, 'f24', '2025-06-01')
  const due = dueForReview(memory, now).map(({ id }) => id)
  expect(due).toHaveLength(REVIEW_LIMIT)
  expect(due).not.toContain('f24')
  expect(due).not.toContain('f25')
  expect(due.slice(0, 3)).toEqual(['f23', 'f22', 'f21'])
  expect(due.indexOf('f1')).toBe(due.indexOf('f12') + 1)
})
