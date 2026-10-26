import { expect, test } from 'vitest'
import {
  CORE_BUDGET,
  coreFacts,
  FactError,
  forgetFact,
  listFacts,
  migrateV1,
  rememberFact,
  retireFact,
  reviseFact,
  setCore,
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
  const essential = rememberFact(
    memory,
    `Allergic to penicillin: ${'details '.repeat(25)}`,
    5,
    2,
  )
  expect(essential.core).toBe(false)
  expect(memory.facts).toContain(essential)
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
      replaces: 'm1',
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
      replaces: 'm3',
    },
  ])
  expect(sheffield.id).toBe('m4')
  expect(coreFacts(memory).map((fact) => fact.id)).toEqual(['m4'])
})

test('revising keeps a core fact in core even past the budget', () => {
  const memory = full(80)
  const first = memory.facts[0]
  const revised = reviseFact(memory, first.id, 'x'.repeat(CORE_BUDGET), 2)
  expect(revised.core).toBe(true)
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
  expect(() => setCore(memory, 'm1', true)).toThrow('already past')
  expect(() => reviseFact(memory, 'm9', 'New', 30)).toThrow('No fact m9')
  expect(() => forgetFact(memory, 'm9')).toThrow('No fact m9')
  expect(memory).toEqual(before)
})

test('the owner can pin a fact into core beyond the budget, and unpin it', () => {
  const memory = full(80)
  const outside = memory.facts.find((fact) => !fact.core)!
  setCore(memory, outside.id, true)
  expect(listFacts(coreFacts(memory)).length).toBeGreaterThan(CORE_BUDGET)
  setCore(memory, outside.id, false)
  expect(outside.core).toBe(false)
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
  setCore(memory, 'm3', false)
  setCore(memory, 'm3', true)
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
