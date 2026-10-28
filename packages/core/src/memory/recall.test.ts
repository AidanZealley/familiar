import { expect, test } from 'vitest'
import { addEpisode, type EpisodesState, type Span } from './episodes.ts'
import { rememberFact, retireFact, reviseFact, type Memory } from './facts.ts'
import { localDay } from '../time/index.ts'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { createExchangeIndex } from './exchanges.ts'
import {
  describe,
  excerpt,
  RECALL_LIMIT,
  RECALL_TOKENS,
  RECALL_TOOL_TOKENS,
  recallAll,
  searchMemory,
} from './recall.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 0, 1)

/** Saves a fact, true since the day it was saved. */
const save = (memory: Memory, text: string, importance: number, at: number) =>
  rememberFact(
    memory,
    { text, importance, since: localDay(at), sources: [] },
    at,
  )

const memoryOf = (...facts: [text: string, importance: number][]) => {
  const memory: Memory = {
    facts: { facts: [], next: 1 },
    usage: { facts: {} },
  }
  for (const [text, importance] of facts) {
    save(memory, text, importance, now - 30 * DAY)
  }
  return memory
}

const ids = (memory: Memory, query: string) =>
  searchMemory(memory.facts, undefined, query, now).found.map(({ item }) =>
    'fact' in item ? item.fact.id : item.episode.id,
  )

test('finds matching facts outside core and leaves out core', () => {
  const memory = memoryOf(
    ["Pip's waterproof coat is 66 cm, from Fell Houndwear", 2],
    ['Pip is a retired greyhound', 5],
    ['The kitchen tap drips', 1],
  )
  expect(ids(memory, 'What size coat does Pip wear?')).toEqual(['f1'])
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
  expect(ids(shed, "Where's the shed key?")).toEqual(['f1'])
})

test('importance and recency rank equally relevant facts', () => {
  const memory = memoryOf(['Minor note about the shed', 1])
  save(memory, 'Important note about the shed', 2, now - 30 * DAY)
  expect(ids(memory, 'shed note')).toEqual(['f2', 'f1'])

  // A past fact ranks lower the longer ago it stopped being true.
  const aged = memoryOf()
  save(aged, 'Shed key was under the pot', 2, now - 4 * 365 * DAY)
  save(aged, 'Shed key was on the hook', 2, now - 60 * DAY)
  retireFact(aged, 'f1', localDay(now - 3 * 365 * DAY))
  retireFact(aged, 'f2', localDay(now - 30 * DAY))
  expect(ids(aged, 'shed key')).toEqual(['f2', 'f1'])
})

test('past facts are found, ranked below current ones and labelled', () => {
  const memory = memoryOf(['Lives at 18 Beech Terrace in Leeds', 2])
  reviseFact(
    memory,
    'f1',
    { text: 'Lives at 9 Foss Lane in York', since: localDay(now - 10 * DAY) },
    now - 10 * DAY,
  )
  memory.facts.facts[1].core = false
  expect(ids(memory, 'Where do I live?')).toEqual(['f2', 'f1'])
  expect(describe(memory.facts, { fact: memory.facts.facts[0] })).toBe(
    'f1 (2025-12-02 to 2025-12-22, replaced by f2): Lives at 18 Beech Terrace in Leeds',
  )
  expect(describe(memory.facts, { fact: memory.facts.facts[1] })).toBe(
    'f2 (since 2025-12-22): Lives at 9 Foss Lane in York',
  )
  retireFact(memory, 'f2', localDay(now))
  expect(describe(memory.facts, { fact: memory.facts.facts[1] })).toContain(
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

  // A fact too long for what's left is skipped, never cut: half a fact can
  // say something else.
  const long = memoryOf(
    [`Garden plan: ${'raised beds and paths '.repeat(13)}`, 2],
    ['Garden gate is 84 cm', 2],
  )
  expect(
    searchMemory(long.facts, undefined, 'garden', now, {
      tokens: 40,
    }).found.map(({ item }) => ('fact' in item ? item.fact.id : '')),
  ).toEqual(['f2'])

  // An episode is shortened to fit rather than dropped.
  const { found } = searchMemory(
    memoryOf().facts,
    episodesOf([
      'month',
      '2025-11-01',
      '2025-11-30',
      `Garden month: ${'planted bulbs and mended paths '.repeat(200)}`,
    ]),
    'garden',
    now,
  )
  expect(found).toHaveLength(1)
  expect(found[0].line).toMatch(/^e1 .*…$/)
  expect(
    found.reduce((total, { line }) => total + estimateTextTokens(line), 0),
  ).toBeLessThanOrEqual(RECALL_TOKENS)
})

test('the index follows changes to memory', () => {
  const memory = memoryOf(['Drinks coffee', 2])
  expect(ids(memory, 'tea')).toEqual([])
  const next = structuredClone(memory)
  save(next, 'Drinks peppermint tea', 2, now)
  expect(ids(next, 'tea')).toEqual(['f2'])
})

const episodesOf = (
  ...episodes: [span: Span, start: string, end: string, text: string][]
) => {
  const state: EpisodesState = { episodes: [], next: 1 }
  for (const [span, start, end, text] of episodes) {
    addEpisode(state, { span, start, end, text, at: now - 30 * DAY })
  }
  return state
}

const found = (memory: Memory, episodes: EpisodesState, query: string) =>
  searchMemory(memory.facts, episodes, query, now).found.map(({ item }) =>
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
  for (let index = 0; index < 5; index++) {
    save(memory, `Unrelated fact ${index}`, 2, now - 30 * DAY)
  }
  // As if core were full of other facts.
  memory.facts.facts[0].core = false
  const episodes = episodesOf([
    'day',
    '2025-03-17',
    '2025-03-17',
    'Reed Shelter is a birdwatching hide',
  ])
  expect(found(memory, episodes, 'Reed Shelter hide')).toEqual(['f1', 'e1'])
})

test('everyday words never recall episodes by date', () => {
  // A month of day episodes and a March week, as in the review that found
  // "may", "match" and small numbers pulling in unrelated episodes.
  const days: [Span, string, string, string][] = Array.from(
    { length: 31 },
    (_, index) => {
      const day = `2025-05-${String(index + 1).padStart(2, '0')}`
      return ['day', day, day, 'An ordinary day of chores.']
    },
  )
  const episodes = episodesOf(...days, [
    'week',
    '2025-03-10',
    '2025-03-16',
    'Repaired flood-damaged atlases.',
  ])
  const memory = memoryOf(
    ['Keeps an umbrella by the door', 2],
    ['Sam goes to chess club', 2],
  )
  expect(
    found(memory, episodes, 'It may rain later, should I take an umbrella?'),
  ).toEqual(['f1'])
  expect(
    found(memory, episodes, 'That is a perfect match for the sofa'),
  ).toEqual([])
  expect(
    found(memory, episodes, 'Sam has a chess club on Friday at 3'),
  ).toEqual(['f2'])
  // An explicit date still finds its day.
  expect(found(memory, episodes, 'What did I do on 3 May?')[0]).toBe('e3')
})

test('core facts a message matches count as used without being shown', () => {
  const memory = memoryOf(['Pip is a retired greyhound', 5])
  const search = searchMemory(
    memory.facts,
    undefined,
    'Is Pip a greyhound?',
    now,
  )
  expect(search.found).toEqual([])
  expect(search.used).toEqual(['f1'])
})

test('automatic recall prefers a rolled-up month to its days, but reaches a day by its date', () => {
  const days: [Span, string, string, string][] = Array.from(
    { length: 30 },
    (_, index) => {
      const day = `2025-11-${String(index + 1).padStart(2, '0')}`
      return ['day', day, day, `Worked on the shed roof, day ${index + 1}.`]
    },
  )
  const episodes = episodesOf(...days, [
    'month',
    '2025-11-01',
    '2025-11-30',
    'A month of shed roof repairs.',
  ])
  const memory = memoryOf()
  expect(found(memory, episodes, 'How did the shed roof go?')).toEqual(['e31'])
  expect(found(memory, episodes, 'What happened on 12 November 2025?')[0]).toBe(
    'e12',
  )
  // Before the rollup, the days themselves are the candidates.
  const unrolled = episodesOf(...days)
  expect(found(memory, unrolled, 'How did the shed roof go?')).toHaveLength(
    RECALL_LIMIT,
  )
})

test('the recall tool groups facts, episodes and exchanges, current facts first', () => {
  const memory = memoryOf(['Lives at 18 Beech Terrace in Leeds', 2])
  reviseFact(
    memory,
    'f1',
    { text: 'Lives at 9 Foss Lane in York', since: '2025-12-01' },
    now,
  )
  memory.facts.facts[1].core = false
  const episodes = episodesOf([
    'day',
    '2025-12-01',
    '2025-12-01',
    'Moved house to Foss Lane in York.',
  ])
  const exchanges = createExchangeIndex()
  exchanges.add({
    id: 'x7',
    at: now - 31 * DAY,
    text: `${'Packing boxes all morning. '.repeat(20)}We finally moved to Foss Lane today and the kettle is lost. ${'Unpacking later. '.repeat(20)}`,
  })
  const { text, used } = recallAll(
    memory.facts,
    episodes,
    exchanges,
    'Where do I live now, Foss Lane?',
    now,
  )
  const lines = text.split('\n')
  expect(lines[0]).toBe('Facts:')
  expect(lines[1]).toMatch(/^f2 \(since 2025-12-01\)/)
  expect(lines[2]).toMatch(/^f1 \(.*replaced by f2\)/)
  expect(lines[3]).toBe('Episodes:')
  expect(lines[4]).toMatch(/^e1 \(day of 2025-12-01\)/)
  expect(lines[5]).toBe('Exchanges:')
  // About 300 characters around the match, not the whole exchange.
  expect(lines[6]).toMatch(/^x7 \(2025-12-01\): ….*Foss Lane.*…$/)
  expect(lines[6].length).toBeLessThan(340)
  expect(used).toEqual(['f2', 'f1'])
  expect(estimateTextTokens(text)).toBeLessThanOrEqual(RECALL_TOOL_TOKENS)
  expect(recallAll(memory.facts, episodes, exchanges, 'zebra', now).text).toBe(
    'Nothing found.',
  )
})

test('an excerpt is the whole text when short, and starts at the match when long', () => {
  expect(excerpt('Short and sweet.', 'sweet')).toBe('Short and sweet.')
  const long = `${'a '.repeat(400)}needle here ${'b '.repeat(400)}`
  expect(excerpt(long, 'the needle')).toMatch(/^….*needle here.*…$/)
})
