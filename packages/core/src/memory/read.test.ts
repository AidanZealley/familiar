import type { EntryId } from '@earendil-works/pi-durable'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { expect, test } from 'vitest'
import { addEpisode, type EpisodesState } from './episodes.ts'
import { createExchangeIndex } from './exchanges.ts'
import { rememberFact, reviseFact, type Memory } from './facts.ts'
import { READ_TOKENS, readMemory } from './read.ts'

const empty = (): Memory => ({
  facts: { facts: [], next: 1 },
  usage: { facts: {} },
})
const noEpisodes = (): EpisodesState => ({ episodes: [], next: 1 })

test('a fact read from before a merge shows everything the merge folded in', () => {
  const memory = empty()
  const fact = (text: string) => ({
    text,
    importance: 3,
    since: '2025-01-01',
    sources: [],
  })
  rememberFact(memory, fact('Has a cat'), 1)
  rememberFact(memory, fact('Cat is called Miso'), 1)
  reviseFact(
    memory,
    'f1',
    { text: 'Has a cat called Miso', since: '2025-02-01', merge: ['f2'] },
    2,
  )
  const read = readMemory(
    'f1',
    memory.facts,
    noEpisodes(),
    createExchangeIndex(),
  )
  const changed = read.split('How it changed, oldest first:\n')[1]
  expect(changed).toMatch(/^f1 .*\nf2 .*\nf3 .*Has a cat called Miso/)
})

test('a long history and long sources stay within the budget', () => {
  const memory = empty()
  const exchanges = createExchangeIndex()
  const sources: EntryId[] = []
  for (let entry = 1; entry <= 20; entry++) {
    exchanges.add({
      id: `x${entry}`,
      at: entry,
      text: 'word '.repeat(1_000),
      last: entry as EntryId,
    })
    sources.push(entry as EntryId)
  }
  rememberFact(
    memory,
    { text: 'Version 0', importance: 3, since: '2020-01-01', sources },
    1,
  )
  for (let version = 1; version < 100; version++) {
    reviseFact(
      memory,
      `f${version}`,
      {
        text: `Version ${version}: ${'detail '.repeat(40)}`,
        since: `2020-01-${String((version % 28) + 1).padStart(2, '0')}`,
      },
      version,
    )
  }
  const read = readMemory('f100', memory.facts, noEpisodes(), exchanges)
  expect(estimateTextTokens(read)).toBeLessThanOrEqual(READ_TOKENS)
  expect(read).toMatch(/Not shown: f\d+, /)
  expect(read).toContain('From:\nx1 ')
})

test('a month lists a day episode that crosses into it', () => {
  const episodes = noEpisodes()
  const at = 1
  addEpisode(episodes, {
    span: 'day',
    start: '2025-01-31',
    end: '2025-02-01',
    text: 'A late night across the month end.',
    at,
  })
  addEpisode(episodes, {
    span: 'month',
    start: '2025-02-01',
    end: '2025-02-28',
    text: 'February.',
    at,
  })
  expect(
    readMemory('e2', empty().facts, episodes, createExchangeIndex()),
  ).toContain('e1 (day of 2025-01-31 to 2025-02-01): A late night')
})

test('an unknown ID says what IDs look like', () => {
  expect(
    readMemory('m4', empty().facts, noEpisodes(), createExchangeIndex()),
  ).toContain('Facts start with f')
})
