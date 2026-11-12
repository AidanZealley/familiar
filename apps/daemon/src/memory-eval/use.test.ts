import { createModels } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createMeter } from './model.ts'
import { runUseEval } from './use.ts'
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
async function evaluate(probes: UseProbe[], fixture?: CoreFixture) {
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
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('proactive probes are graded with and without memory, and an empty memory shows the model no facts', async () => {
  const run = await evaluate([
    probe({ id: 'allergy' }),
    probe({
      id: 'unrelated',
      kind: 'restraint',
      request: 'How many kilometres is five miles?',
      required: [],
      forbidden: ['peanut'],
    }),
  ])
  if (run.status !== 'done') {
    throw new Error(run.reason)
  }
  const { grade } = run
  const [withMemory, without] = grade.outcomes.filter(
    (outcome) => outcome.probe === 'allergy',
  )
  expect(withMemory).toMatchObject({ memory: true, passed: true })
  expect(without).toMatchObject({ memory: false, passed: false, missing: true })
  expect(without.reply.toLowerCase()).not.toContain('peanut')
  expect(grade.proactive).toMatchObject({
    with: { passed: 1, total: 1 },
    without: { passed: 0, total: 1 },
    gain: 1,
  })
  // The echoing model leaks the fact into an unrelated reply, so restraint fails.
  expect(grade.restraint).toMatchObject({ passed: 0, total: 1 })
  expect(grade.outcomes.find((o) => o.kind === 'restraint')?.forbidden).toEqual(
    ['peanut'],
  )
})

test('a fixture seeds every probe from its facts and runs only the probes those facts cover', async () => {
  const fixture = {
    scenario: 'tiny',
    hash: 'test',
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
    with: { passed: 1, total: 1 },
    without: { passed: 0, total: 1 },
  })
})
