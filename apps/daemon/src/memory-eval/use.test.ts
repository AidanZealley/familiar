import { createModels } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createMeter } from './model.ts'
import { gradeUse, runUseEval, type UseOutcome } from './use.ts'
import type { CoreFixture } from './core-fixture.ts'
import type { UseProbe } from './use-probes.ts'

const maya = { id: 'maya', name: 'Maya' }
const fact = {
  about: maya,
  text: 'has a severe peanut allergy.',
  importance: 5,
}
const probe = (extra: Partial<UseProbe>): UseProbe => ({
  id: 'p',
  kind: 'proactive',
  asker: maya,
  place: 'dm',
  facts: [fact],
  request: 'What should I eat on Saturday?',
  required: ['peanut'],
  forbidden: [],
  ...extra,
})

/** Answers with everything the model was shown, so it "uses" whatever memory reached it. */
async function evaluate(probes: UseProbe[], fixture?: CoreFixture, repeat = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-use-test-'))
  try {
    const meter = createMeter(1_000_000)
    const scripted = scriptedModels(
      (request) =>
        fauxAssistantMessage(
          request.type === 'background'
            ? 'Summary.'
            : JSON.stringify(request.context),
        ),
      { models: [{ id: 'eval-chat', contextWindow: 200_000 }] },
    )
    const models = createModels()
    models.setProvider(meter.wrap(scripted.getProvider('faux')!))
    return await runUseEval({
      probes,
      models,
      chat: {
        model: { provider: 'faux', modelId: 'eval-chat' },
        thinkingLevel: 'off',
      },
      meter,
      directory,
      fixture,
      repeat,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('a proactive probe runs with its fact in core, outside it and absent, and the rescue rate is how many still pass outside', async () => {
  const run = await evaluate(
    [
      // Shares no word with its fact, so recall can't find it outside core.
      probe({ id: 'allergy' }),
      // Shares "kiwi", so recall rescues it.
      probe({
        id: 'kiwi',
        facts: [
          { about: maya, text: 'is allergic to kiwi fruit.', importance: 5 },
        ],
        request: 'Is a kiwi smoothie fine for breakfast?',
        required: ['allergic'],
      }),
      probe({
        id: 'unrelated',
        kind: 'restraint',
        request: 'How many kilometres is five miles?',
        required: [],
        forbidden: ['peanut'],
      }),
    ],
    undefined,
    2,
  )
  if (run.status !== 'done') {
    throw new Error(run.reason)
  }
  const { grade } = run
  // Proactive probes run in every placement twice; the other kinds once.
  expect(grade.outcomes).toHaveLength(2 * 2 * 3 + 1)
  const outcome = (probe: string, placement: string) =>
    grade.outcomes.find((o) => o.probe === probe && o.placement === placement)
  expect(outcome('allergy', 'core')).toMatchObject({ passed: true })
  expect(outcome('allergy', 'outside')).toMatchObject({
    passed: false,
    recalled: false,
  })
  expect(outcome('kiwi', 'outside')).toMatchObject({
    passed: true,
    recalled: true,
  })
  // An empty memory shows the model no facts.
  const none = outcome('allergy', 'none')
  expect(none).toMatchObject({ passed: false, missing: true })
  expect(none?.reply.toLowerCase()).not.toContain('peanut')
  // The scripted reply doesn't vary, so the repeats agree and the range is a point.
  const point = (mean: number) => ({ mean, min: mean, max: mean })
  expect(grade.proactive).toMatchObject({
    probes: 2,
    repeats: 2,
    with: point(1),
    outside: point(0.5),
    without: point(0),
    gain: point(1),
    rescue: point(0.5),
    recalled: point(0.5),
  })
  // The echoing model leaks the fact into an unrelated reply, so restraint fails.
  expect(grade.restraint).toMatchObject({ passed: 0, total: 1 })
  expect(outcome('unrelated', 'placed')?.forbidden).toEqual(['peanut'])
})

test('a fixture seeds every probe from its facts and runs only the probes those facts cover', async () => {
  const fixture = {
    scenario: 'tiny',
    hash: 'test',
    replay: 1,
    model: 'faux/upkeep@low',
    facts: {
      facts: [
        {
          id: 'f1',
          text: 'Maya (author ID maya) is allergic to kiwi',
          importance: 5,
          since: '2026-01-05',
          sources: [],
          saved: 0,
          core: false,
        },
        {
          id: 'f2',
          text: 'Maya has a severe peanut allergy',
          importance: 5,
          since: '2026-01-05',
          until: '2026-02-01',
          sources: [],
          saved: 0,
          core: false,
        },
      ],
      next: 3,
    },
    usage: { facts: {} },
    episodes: { episodes: [], next: 1 },
    clock: new Date('2026-03-06T04:00:00').getTime(),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    elapsedMs: 0,
  } satisfies CoreFixture
  const run = await evaluate(
    [
      // Own facts say peanut, but the fixture's current facts only say kiwi.
      probe({ id: 'peanut' }),
      probe({ id: 'kiwi', required: ['kiwi'], facts: [] }),
    ],
    fixture,
  )
  if (run.status !== 'done') {
    throw new Error(run.reason)
  }
  expect(run.grade.skipped).toEqual(['peanut'])
  expect(run.grade.proactive).toMatchObject({
    with: { mean: 1 },
    without: { mean: 0 },
  })
})

test('each rate is averaged over the repeats and reported with the range they fell in', () => {
  const outcome = (
    probe: string,
    placement: UseOutcome['placement'],
    repeat: number,
    passed: boolean,
    recalled?: boolean,
  ): UseOutcome => ({
    probe,
    kind: 'proactive',
    placement,
    repeat,
    ...(recalled === undefined ? {} : { recalled }),
    asked: false,
    passed,
    answered: true,
    missing: !passed,
    forbidden: [],
    reply: '',
  })
  // Two probes over three repeats. Both pass from core every time; outside,
  // `a` passes in repeats 0 and 1 and `b` in repeat 0 only, so outside runs
  // 2/2, 1/2 and 0/2. Only `a` passes with no memory, once.
  const outcomes = [0, 1, 2].flatMap((repeat) => [
    outcome('a', 'core', repeat, true),
    outcome('b', 'core', repeat, true),
    outcome('a', 'outside', repeat, repeat < 2, true),
    outcome('b', 'outside', repeat, repeat < 1, false),
    outcome('a', 'none', repeat, repeat === 2),
    outcome('b', 'none', repeat, false),
  ])
  const { proactive } = gradeUse(outcomes, {
    skipped: [],
    model: 'faux/chat@off',
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    elapsedMs: 0,
  })
  expect(proactive).toMatchObject({
    probes: 2,
    repeats: 3,
    with: { mean: 1, min: 1, max: 1 },
    outside: { mean: 0.5, min: 0, max: 1 },
    without: { mean: 0.167, min: 0, max: 0.5 },
    // Core passes everywhere, so rescue is the outside rate.
    rescue: { mean: 0.5, min: 0, max: 1 },
    gain: { mean: 0.833, min: 0.5, max: 1 },
    recalled: { mean: 0.5, min: 0.5, max: 0.5 },
  })
})
