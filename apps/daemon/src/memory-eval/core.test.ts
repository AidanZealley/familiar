import { createModels } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { rebalanceCore, type Fact } from '@familiar-ai/core/diagnostics'
import { expect, test } from 'vitest'
import type { CoreFixture } from './core-fixture.ts'
import { gradeCore, summariseCore } from './core-grade.ts'
import type { CoreScenario } from './core-scenario.ts'
import type { EntryId } from '@earendil-works/pi-durable'
import { upkeepGap } from './core.ts'
import { createMeter, TokenCapError } from './model.ts'

const scenario: CoreScenario = {
  id: 'tiny',
  owner: { id: 'maya', name: 'Maya' },
  other: { id: 'theo', name: 'Theo' },
  start: '2026-01-05',
  end: '2026-01-06',
  days: [
    {
      date: '2026-01-05',
      messages: [
        {
          by: 'owner',
          in: 'dm',
          text: 'I have a peanut allergy. I live on Elm Row. I boulder at The Arch.',
          items: [
            { id: 'allergy', label: 'core', match: ['peanut'] },
            {
              id: 'home',
              label: 'changes',
              from: ['Elm Row'],
              to: 'Quarry Lane',
            },
            { id: 'climbing', label: 'recall', match: ['boulder'] },
          ],
        },
      ],
    },
    {
      date: '2026-01-06',
      messages: [
        {
          by: 'owner',
          in: 'room',
          text: 'Moved to Quarry Lane. Had tuna for lunch.',
          items: [{ id: 'lunch', label: 'none', match: ['tuna'] }],
        },
      ],
    },
  ],
}

const fact = (
  id: string,
  text: string,
  importance: number,
  extra: Partial<Fact> = {},
): Fact => ({
  id,
  text,
  importance,
  since: '2026-01-05',
  sources: [],
  saved: 0,
  core: false,
  ...extra,
})

const fixture: CoreFixture = {
  scenario: 'tiny',
  hash: 'test',
  replay: 1,
  model: 'faux/upkeep@low',
  facts: {
    facts: [
      fact('f1', 'Maya has a severe peanut allergy', 5),
      fact('f2', 'Maya lives at Elm Row', 4, { until: '2026-01-06' }),
      fact('f3', 'Maya lives at Quarry Lane', 4, { replaces: ['f2'] }),
      fact('f4', 'Maya boulders at The Arch', 3),
      fact('f5', 'Maya had tuna for lunch', 1),
    ],
    next: 6,
  },
  usage: { facts: {} },
  episodes: { episodes: [], next: 1 },
  clock: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  elapsedMs: 0,
}

test('grading re-runs the ranking it is given over the saved memory, so a ranking change is measured without a model', () => {
  const grade = gradeCore(fixture, { scenario })
  expect(gradeCore(fixture, { scenario })).toEqual(grade)
  expect(grade).toMatchObject({
    // Ranking put f1 and f3 in core, though the fixture saved none there.
    core: { facts: 2 },
    corePrecision: 0.5,
    coreRecall: 1,
    recallInCore: 0,
    junkRate: 1,
    changesCorrect: 1,
  })
  expect(fixture.facts.facts.every((fact) => !fact.core)).toBe(true)

  // As if CORE_IMPORTANCE were 3: the recall-only 3 joins core.
  const looser = gradeCore(fixture, {
    scenario,
    rebalance: (memory) => {
      rebalanceCore(memory)
      for (const fact of memory.facts.facts) {
        fact.core ||= fact.importance === 3
      }
    },
  })
  expect(looser).toMatchObject({ core: { facts: 3 }, recallInCore: 1 })
})

test('grading also cuts core to a smaller budget, where ranking has to choose, and reports fades that were recalled after their last mention', () => {
  const fading: CoreScenario = {
    ...scenario,
    days: [
      {
        date: '2026-01-05',
        messages: [
          {
            by: 'owner',
            in: 'dm',
            text: 'Flying to Lisbon on the 23rd. I have a peanut allergy.',
            items: [
              { id: 'allergy', label: 'core', match: ['peanut'] },
              { id: 'lisbon', label: 'fades', match: ['Lisbon'] },
            ],
          },
        ],
      },
      {
        date: '2026-01-21',
        messages: [{ by: 'owner', in: 'dm', text: 'Packing for Lisbon.' }],
      },
    ],
  }
  const trip = fact('f6', 'Maya flies to Lisbon on 23 January', 4)
  const recalled = (at: string) => ({
    facts: { f6: { recalled: new Date(at).getTime() } },
  })
  const grade = (usage: CoreFixture['usage']) =>
    gradeCore(
      {
        ...fixture,
        facts: { facts: [...fixture.facts.facts, trip], next: 7 },
        usage,
      },
      // f1 (37 characters) fits alone; f1 and the importance-4 facts don't.
      { scenario: fading, pressure: 40 },
    )

  const nothing = grade({ facts: {} })
  // Within the real budget everything rated 4 or more is in core, the trip too.
  expect(nothing).toMatchObject({
    budget: 6000,
    core: { facts: 3 },
    fadesOut: 0,
    fadesRefreshed: 0,
  })
  expect(nothing.pressure).toMatchObject({
    budget: 40,
    core: { facts: 1 },
    coreRecall: 1,
    corePrecision: 1,
    fadesOut: 1,
  })
  // Recalled on 1 February, after the last message naming Lisbon (21 January).
  expect(grade(recalled('2026-02-01T12:00:00')).fadesRefreshed).toBe(1)
  expect(grade(recalled('2026-01-21T12:30:00')).fadesRefreshed).toBe(0)
})

test('replays are graded separately and averaged, with the range they fell in and the items they disagreed on', () => {
  // A second replay in which upkeep dropped the allergy.
  const second: CoreFixture = {
    ...fixture,
    replay: 2,
    facts: {
      ...fixture.facts,
      facts: fixture.facts.facts.filter((fact) => fact.id !== 'f1'),
    },
  }
  const summary = summariseCore([
    gradeCore(fixture, { scenario }),
    gradeCore(second, { scenario }),
  ])
  expect(summary).toMatchObject({
    replays: 2,
    labelled: { core: 1, changes: 1, recall: 1, none: 1 },
    // Core recall is 1 with the allergy and 0 without it.
    real: { coreRecall: { mean: 0.5, min: 0, max: 1 } },
    junkRate: { mean: 1, min: 1, max: 1 },
  })
  expect(summary.missed).toEqual([
    { id: 'allergy', label: 'core', real: 1, pressure: 1 },
    { id: 'lunch', label: 'none', real: 0, pressure: 0 },
  ])
})

test('the meter counts every response and, past its cap, stops the run and aborts further requests', async () => {
  const meter = createMeter(1)
  const scripted = scriptedModels(() => fauxAssistantMessage('Done.'))
  const models = createModels()
  models.setProvider(meter.wrap(scripted.getProvider('faux')!))
  const model = models.getModel('faux', 'faux-1')!
  const ask = () =>
    models.completeSimple(model, {
      messages: [{ role: 'user', content: 'File the day.', timestamp: 0 }],
    })

  expect(() => meter.check()).not.toThrow()
  await ask()
  expect(meter.totals().total).toBeGreaterThan(1)
  expect(() => meter.check()).toThrow(TokenCapError)

  expect((await ask()).stopReason).toBe('aborted')
})

test('a replay whose upkeep stopped short of the last message is not trusted', () => {
  const id = (value: number) => value as EntryId
  expect(upkeepGap(id(9), null)).toMatch(/none/)
  expect(upkeepGap(id(9), id(4))).toMatch(/entry 4/)
  expect(upkeepGap(id(9), id(9))).toBeUndefined()
})
