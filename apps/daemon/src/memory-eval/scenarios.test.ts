import {
  fauxAssistantMessage,
  fauxProvider,
} from '@familiar-ai/core/models/faux'
import { createModels } from '@familiar-ai/core/models'
import { expect, test } from 'vitest'
import { createMeter, type EvalAccess } from './model.ts'
import { grade, scenarios, type Scenario } from './scenarios.ts'
import { runScenario } from './scenarios-run.ts'

test('every scenario states what it tests and grades at least one thing', () => {
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length)
  expect(scenarios.length).toBeGreaterThanOrEqual(9)
  for (const scenario of scenarios) {
    expect(scenario.tests).toBeTruthy()
    expect(scenario.probes.length).toBeGreaterThan(0)
    for (const probe of scenario.probes) {
      expect(probe.reply ?? probe.section ?? probe.recalled).toBeDefined()
    }
  }
})

test('grading is by strings alone, without regard to case', () => {
  expect(
    grade(
      'reply',
      { includes: ['Bristol'], excludes: ['Leeds'] },
      'You live in BRISTOL.',
    ),
  ).toEqual([])
  expect(
    grade(
      'reply',
      { includes: ['Bristol'], includesAny: ['x', 'y'], excludes: ['Leeds'] },
      'Still in leeds.',
    ),
  ).toEqual([
    'reply lacks "Bristol"',
    'reply has none of "x", "y"',
    'reply contains "Leeds"',
  ])
})

test('a scenario is played in a real workspace and graded on what the model said and was shown', async () => {
  const faux = fauxProvider({ models: [{ id: 'memory' }, { id: 'reply' }] })
  const step = (
    _context: unknown,
    _options: unknown,
    _state: unknown,
    model: { id: string },
  ) => {
    faux.appendResponses([step])
    return fauxAssistantMessage(
      model.id === 'reply' ? 'You live in Bristol.' : 'Nothing to change.',
    )
  }
  faux.setResponses([step])
  const wrap = (meter: Parameters<EvalAccess['models']>[0]) => {
    const models = createModels()
    models.setProvider(meter.wrap(faux.provider))
    return models
  }
  const choice = (modelId: string) => ({
    model: { provider: 'faux', modelId },
    thinkingLevel: 'low' as const,
  })
  const access: EvalAccess = {
    names: { memory: 'memory', reply: 'reply', judge: 'reply' },
    memory: choice('memory'),
    reply: choice('reply'),
    judge: choice('reply'),
    models: wrap,
    judgeModels: wrap,
  }
  const scenario: Scenario = {
    id: 'test',
    tests: 'The runner.',
    rooms: ['kitchen'],
    say: [
      { day: 0, who: 'Aidan', text: 'I live in Bristol.' },
      { day: 0, who: 'Maya', room: 'kitchen', text: 'Hello.' },
    ],
    probes: [
      {
        day: 2,
        who: 'Aidan',
        text: 'Where do I live?',
        reply: { includes: ['Bristol'], excludes: ['Leeds'] },
        // The section is the memory section of the prompt; its heading is Familiar's.
        section: { includes: ['What you remember'] },
      },
      {
        day: 2,
        who: 'Maya',
        room: 'kitchen',
        text: 'Where do I live?',
        reply: { includes: ['Leeds'] },
      },
    ],
  }
  const result = await runScenario(scenario, access, createMeter(Infinity))
  expect(result.probes.map((probe) => probe.failures)).toEqual([
    [],
    ['reply lacks "Leeds"'],
  ])
  expect(result.probes[0].shown.reply).toBe('You live in Bristol.')
  expect(result.probes[0].shown.section).toContain('What you remember')
  expect(result.passed).toBe(false)
  expect(result.tokens.total).toBeGreaterThanOrEqual(0)
})
