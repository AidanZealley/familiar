import { expect, test } from 'vitest'
import { addEpisode, type EpisodesState, type Span } from './episodes.ts'
import {
  rememberFact,
  retireFact,
  reviseFact,
  type MemoryState,
} from './facts.ts'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  describe,
  RECALL_LIMIT,
  RECALL_TOKENS,
  searchMemory,
} from './recall.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 0, 1)

const memoryOf = (...facts: [text: string, importance: number][]) => {
  const memory: MemoryState = { facts: [], next: 1 }
  for (const [text, importance] of facts)
    rememberFact(memory, text, importance, now - 30 * DAY)
  return memory
}

const ids = (memory: MemoryState, query: string) =>
  searchMemory(memory, undefined, query, now).map(({ item }) =>
    'fact' in item ? item.fact.id : item.episode.id,
  )

test('finds matching facts outside core and leaves out core', () => {
  const memory = memoryOf(
    ["Pip's waterproof coat is 66 cm, from Fell Houndwear", 2],
    ['Pip is a retired greyhound', 5],
    ['The kitchen tap drips', 1],
  )
  expect(ids(memory, 'What size coat does Pip wear?')).toEqual(['m1'])
})

test('a message with no meaningful overlap recalls nothing', () => {
  const memory = memoryOf(
    ["Pip's waterproof coat is 66 cm", 2],
    ['Likes blue pens', 1],
  )
  expect(ids(memory, 'How are you doing today?')).toEqual([])

  // Contraction fragments ("s", "t") must not prefix-match whole words.
  const shed = memoryOf(
    ['Shed key is under the pot', 2],
    ['Takes the tram to work', 2],
    ['Samsung phone has a cracked screen', 1],
  )
  expect(ids(shed, "What's the weather today?")).toEqual([])
  expect(ids(shed, "Don't worry about it")).toEqual([])
  expect(ids(shed, "Where's the shed key?")).toEqual(['m1'])
})

test('importance and recency rank equally relevant facts', () => {
  const memory = memoryOf(['Minor note about the shed', 1])
  rememberFact(memory, 'Important note about the shed', 2, now - 30 * DAY)
  expect(ids(memory, 'shed note')).toEqual(['m2', 'm1'])

  const aged = memoryOf(['Shed key is under the pot', 2])
  rememberFact(aged, 'Shed key is on the hook', 2, now - 3 * 365 * DAY)
  expect(ids(aged, 'shed key')).toEqual(['m1', 'm2'])
})

test('past facts are found, ranked below current ones and labelled', () => {
  const memory = memoryOf(['Lives at 18 Beech Terrace in Leeds', 2])
  reviseFact(memory, 'm1', 'Lives at 9 Foss Lane in York', now - 10 * DAY)
  memory.facts[1].core = false
  expect(ids(memory, 'Where do I live?')).toEqual(['m2', 'm1'])
  expect(describe(memory, { fact: memory.facts[0] })).toBe(
    'm1 (2025-12-02 to 2025-12-22, no longer current; replaced by m2): Lives at 18 Beech Terrace in Leeds',
  )
  expect(describe(memory, { fact: memory.facts[1] })).toBe(
    'm2 (since 2025-12-22): Lives at 9 Foss Lane in York',
  )
  retireFact(memory, 'm2', now)
  expect(describe(memory, { fact: memory.facts[1] })).toContain(
    'to 2026-01-01, no longer current): ',
  )
})

test('stays within the limit and the token budget', () => {
  const many = memoryOf(
    ...Array.from(
      { length: 20 },
      (_, index) => [`Garden note ${index}`, 1] as [string, number],
    ),
  )
  expect(ids(many, 'garden')).toHaveLength(RECALL_LIMIT)

  // Too long for what's left: shortened to fit rather than dropped.
  const long = memoryOf(
    [`Garden plan: ${'raised beds and paths '.repeat(300)}`, 2],
    ['Garden gate is 84 cm', 2],
  )
  const found = searchMemory(long, undefined, 'garden', now)
  expect(found.map(({ item }) => 'fact' in item && item.fact.id)).toEqual([
    'm2',
    'm1',
  ])
  expect(found[1].line).toMatch(/^m1 .*…$/)
  expect(
    found.reduce((total, { line }) => total + estimateTextTokens(line), 0),
  ).toBeLessThanOrEqual(RECALL_TOKENS)
})

test('the index follows changes to memory', () => {
  const memory = memoryOf(['Drinks coffee', 2])
  expect(ids(memory, 'tea')).toEqual([])
  const next = structuredClone(memory)
  rememberFact(next, 'Drinks peppermint tea', 2, now)
  expect(ids(next, 'tea')).toEqual(['m2'])
})

const episodesOf = (
  ...episodes: [span: Span, start: string, end: string, text: string][]
) => {
  const state: EpisodesState = { episodes: [], next: 1 }
  for (const [span, start, end, text] of episodes)
    addEpisode(state, { span, start, end, text, at: now - 30 * DAY })
  return state
}

const found = (memory: MemoryState, episodes: EpisodesState, query: string) =>
  searchMemory(memory, episodes, query, now).map(({ item }) =>
    'fact' in item ? item.fact.id : item.episode.id,
  )

test('episodes are found by when they happened, not only by their words', () => {
  const episodes = episodesOf(
    ['day', '2025-03-04', '2025-03-04', 'Fired the porcelain tiles.'],
    ['week', '2025-03-10', '2025-03-16', 'Repaired flood-damaged atlases.'],
    ['month', '2025-04-01', '2025-04-30', 'Paper Moon was performed.'],
  )
  const memory = memoryOf()
  expect(found(memory, episodes, 'What was going on in March?').sort()).toEqual(
    ['e1', 'e2'],
  )
  expect(found(memory, episodes, 'What happened on Tuesday 4 March?')[0]).toBe(
    'e1',
  )
  expect(found(memory, episodes, 'And in April 2025?')[0]).toBe('e3')
})

test('facts and episodes are ranked on the same scale', () => {
  // The same words: the essential fact must not lose to an ordinary episode
  // just because those words are rarer among episodes.
  const memory = memoryOf(['Reed Shelter is a birdwatching hide', 5])
  for (let index = 0; index < 5; index++)
    rememberFact(memory, `Unrelated fact ${index}`, 2, now - 30 * DAY)
  // As if core were full of other facts.
  memory.facts[0].core = false
  const episodes = episodesOf([
    'day',
    '2025-03-17',
    '2025-03-17',
    'Reed Shelter is a birdwatching hide',
  ])
  expect(found(memory, episodes, 'Reed Shelter hide')).toEqual(['m1', 'e1'])
})
