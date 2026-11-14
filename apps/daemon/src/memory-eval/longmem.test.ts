import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { createModels } from '@familiar-ai/core/models'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  idsOf,
  questionOf,
  SET_SIZES,
  selectSets,
  STRATA,
  type Entry,
  type Question,
} from './longmem-data.ts'
import { writeHistory } from './longmem-history.ts'
import { projectTokens, summarise } from './longmem-report.ts'
import { groupsOf, openMemorySearch } from './longmem-retrieval.ts'
import { openRun, reuse, RunMismatch, type RunKey } from './longmem-run.ts'
import { runQuestion } from './longmem.ts'
import { runSet, SAMPLE, type SetOptions } from './longmem-set.ts'
import {
  classifyLimit,
  createMeter,
  UsageLimitError,
  type EvalAccess,
} from './model.ts'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'familiar-longmem-test-'))
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const entryFor = (
  index: number,
  type: Entry['question_type'],
  abstention = false,
): Pick<Entry, 'question_id' | 'question_type'> => ({
  question_id: `q${String(index).padStart(3, '0')}${abstention ? '_abs' : ''}`,
  question_type: type,
})

test('the dev and holdout sets are seeded, stratified, disjoint and the same every time', () => {
  const types = [
    'single-session-user',
    'single-session-assistant',
    'single-session-preference',
    'multi-session',
    'knowledge-update',
    'temporal-reasoning',
  ] as const
  const entries = Array.from({ length: 600 }, (_, index) =>
    entryFor(index, types[index % types.length], index % 20 === 0),
  )
  const sets = selectSets(entries)
  expect(selectSets([...entries].reverse())).toEqual(sets)
  expect(sets.dev).toHaveLength(
    Object.values(SET_SIZES.dev).reduce((a, b) => a + b),
  )
  expect(sets.holdout).toHaveLength(
    Object.values(SET_SIZES.holdout).reduce((a, b) => a + b),
  )
  expect(new Set([...sets.dev, ...sets.holdout]).size).toBe(
    sets.dev.length + sets.holdout.length,
  )
  expect(idsOf('milestone', sets, entries)).toEqual([
    ...sets.dev,
    ...sets.holdout,
  ])
  expect(idsOf('full', sets, entries)).toHaveLength(600)
  expect(STRATA).toContain('abstention')
})

/** Two sessions that the old replay could not run: one opens with the assistant, one ends on the user. */
const entry = (): Entry => ({
  question_id: 'q1',
  question_type: 'single-session-user',
  question: 'What did I say about lasagna?',
  question_date: '2023/05/30 (Tue) 23:40',
  answer: 'Too much cheese.',
  answer_session_ids: ['s2'],
  haystack_dates: ['2023/05/21 (Sun) 09:00', '2023/05/20 (Sat) 18:30'],
  haystack_session_ids: ['s2', 's1'],
  haystack_sessions: [
    [
      {
        role: 'user',
        content: 'My lasagna had too much cheese.',
        has_answer: true,
      },
      { role: 'assistant', content: 'Noted: less cheese next time.' },
      { role: 'user', content: 'Thanks, what about wine?' },
    ],
    [
      { role: 'assistant', content: 'Welcome back! Anything to cook?' },
      { role: 'user', content: 'Maybe a pie.' },
      { role: 'assistant', content: 'A pie sounds good.' },
    ],
  ],
})

test('a written history reads back as the right exchanges with their original dates', async () => {
  const question = questionOf(entry())
  // The release lists sessions out of order; they are written oldest first.
  expect(question.sessions.map((session) => session.id)).toEqual(['s1', 's2'])
  const store = await writeHistory(join(directory, 'store.sqlite'), question, {
    asking: true,
  })
  expect(store.viewStart).toBeDefined()

  const memory = await openMemorySearch(store)
  try {
    const [first, second] = question.sessions
    const ask = (text: string) =>
      memory.search({ ...question, question: text }, 10)

    const [lasagna] = await ask('lasagna')
    expect(lasagna.at).toBe(second.at)
    expect(lasagna.text).toContain('less cheese next time')

    // A session that opens with the assistant: the user's turn is found, dated as written.
    const [pie] = await ask('pie')
    expect(pie.at).toBe(first.at + 60_000)
    expect(pie.text).toContain('A pie sounds good')

    // A session that ends on the user: an exchange with no reply, still found.
    const [wine] = await ask('wine')
    expect(wine.at).toBe(second.at + 2 * 60_000)
    expect(wine.text).not.toContain('Noted')

    // The labels follow the exchanges: the evidence turn is in the lasagna one.
    const { groups } = groupsOf(store.written)
    expect(groups.get(lasagna.id)).toMatchObject({
      sessions: new Set(['s2']),
      hasAnswer: true,
    })
    expect(groups.get(pie.id)?.hasAnswer).toBe(false)
  } finally {
    await memory.close()
  }
})

test('provider limit errors are told from other failures, with when they lift', () => {
  const now = 1_000_000
  expect(
    classifyLimit(
      'You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.',
      now,
    ),
  ).toEqual({ resetAt: now + 90 * 60_000 })
  expect(
    classifyLimit(
      'Rate limit reached for gpt-4o. Please try again in 6m0s.',
      now,
    ),
  ).toEqual({ resetAt: now + 6 * 60_000 })
  expect(classifyLimit('429 Too Many Requests, retry-after: 30', now)).toEqual({
    resetAt: now + 30_000,
  })
  expect(classifyLimit('You exceeded your current quota', now)).toEqual({})
  expect(classifyLimit('500 Internal server error', now)).toBeUndefined()
  expect(classifyLimit('Invalid API key', now)).toBeUndefined()
  expect(classifyLimit(undefined, now)).toBeUndefined()
})

test('a usage limit trips the meter, and everything it reports into', async () => {
  const root = createMeter(Infinity)
  const stage = createMeter(Infinity, { parent: root })
  stage.trip(new UsageLimitError('limit', 5))
  expect(() => root.check()).toThrow(UsageLimitError)
  expect(() => stage.check()).toThrow(UsageLimitError)
})

/** Scripted models for the three stages, counting what each is asked. */
function scripted(replies: {
  reply: () => ReturnType<typeof fauxAssistantMessage>
}) {
  const faux = fauxProvider({
    models: [{ id: 'memory' }, { id: 'reply' }, { id: 'judge' }],
  })
  const calls = { memory: 0, reply: 0, judge: 0 }
  /** What the reply model was sent, as text. */
  const sent: string[] = []
  const step = (
    context: TranscriptContext,
    _options: unknown,
    _state: unknown,
    model: { id: string },
  ) => {
    faux.appendResponses([step])
    calls[model.id as keyof typeof calls]++
    if (model.id === 'reply') {
      sent.push(JSON.stringify(context.messages))
    }
    return model.id === 'reply'
      ? replies.reply()
      : model.id === 'judge'
        ? fauxAssistantMessage('yes')
        : // Memory files nothing, in its one call.
          fauxAssistantMessage([fauxToolCall('file', {})], {
            stopReason: 'toolUse',
          })
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
    names: {
      memory: 'openai/memory',
      reply: 'openai/reply',
      judge: 'openai/judge',
    },
    memory: choice('memory'),
    reply: choice('reply'),
    judge: choice('judge'),
    models: wrap,
    judgeModels: wrap,
  }
  return { access, calls, sent }
}

const key: RunKey = {
  set: 'dev',
  haystack: 'full',
  models: { memory: 'a', reply: 'b', judge: 'c' },
  code: 'x',
}

test('a limit stops a question cleanly, and a rerun skips what was saved', async () => {
  const question: Question = questionOf(entry())
  let limited = true
  const { access, calls } = scripted({
    reply: () =>
      limited
        ? fauxAssistantMessage([], {
            stopReason: 'error',
            errorMessage:
              'You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.',
          })
        : fauxAssistantMessage('Too much cheese.'),
  })
  const run = openRun(join(directory, 'run'), key)
  const options = () => ({
    run,
    access,
    root: createMeter(Infinity),
    scratch: directory,
  })

  const before = Date.now()
  const error = await runQuestion(question, options()).catch((e) => e)
  expect(error).toBeInstanceOf(UsageLimitError)
  expect(error.resetAt).toBeGreaterThan(before + 89 * 60_000)
  // The filing is saved; nothing was judged, so nothing counts as wrong.
  const stopped = run.read(question.id)!
  expect(stopped.filing).toBeDefined()
  expect(stopped.reply).toBeUndefined()
  expect(stopped.judge).toBeUndefined()
  const filingCalls = calls.memory
  expect(filingCalls).toBeGreaterThan(0)
  expect(calls.judge).toBe(0)

  // Once the limit lifts, only the reply and the judge run.
  limited = false
  const done = await runQuestion(question, options())
  expect(calls.memory).toBe(filingCalls)
  expect(done.reply?.text).toBe('Too much cheese.')
  expect(done.judge?.correct).toBe(true)

  // Everything is saved now, so a rerun asks nothing.
  const asked = { ...calls }
  await runQuestion(question, options())
  expect(calls).toEqual(asked)

  const summary = summarise([run.read(question.id)!])
  expect(summary).toMatchObject({ questions: 1, correct: 1 })
  expect(summary.tokens.total.total).toBeGreaterThanOrEqual(0)
})

test('a run refuses saved work made with another model, set or code', () => {
  const path = join(directory, 'run')
  openRun(path, key)
  expect(() => openRun(path, key)).not.toThrow()
  expect(() =>
    openRun(path, { ...key, models: { ...key.models, reply: 'other' } }),
  ).toThrow(RunMismatch)
  expect(() => openRun(path, { ...key, set: 'holdout' })).toThrow(RunMismatch)
  expect(() => openRun(path, { ...key, code: 'y' })).toThrow(RunMismatch)
  expect(() =>
    openRun(path, { ...key, code: 'y' }, { fresh: true }),
  ).not.toThrow()
})

test('a reask run takes over filing alone, and a rejudge run filing and replies', () => {
  const filed = openRun(join(directory, 'filed'), key)
  const tokens = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }
  filed.write({
    question: 'q',
    type: 'multi-session',
    filing: { tokens, elapsedMs: 1 },
    reply: { tokens, elapsedMs: 1, text: 'old' },
  })
  writeFileSync(filed.storePath('q'), 'store')
  const reask = openRun(join(directory, 'reask'), {
    ...key,
    code: 'y',
    reused: { code: key.code, through: 'filing' },
  })
  reuse(filed, reask, 'filing')
  expect(existsSync(reask.storePath('q'))).toBe(true)
  expect(reask.read('q')).toEqual({
    question: 'q',
    type: 'multi-session',
    filing: { tokens, elapsedMs: 1 },
  })
  const rejudge = openRun(join(directory, 'rejudge'), {
    ...key,
    models: { ...key.models, judge: 'other' },
    reused: { code: key.code, through: 'reply' },
  })
  reuse(filed, rejudge, 'reply')
  expect(rejudge.read('q')?.reply?.text).toBe('old')
})

test('the projection is the mean of what the measured questions cost, stage by stage', () => {
  const tokens = (total: number) => ({
    input: total,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total,
  })
  const stage = (total: number) => ({ tokens: tokens(total), elapsedMs: 1 })
  const projection = projectTokens(
    [
      {
        question: 'a',
        type: 'multi-session',
        filing: stage(1000),
        reply: { ...stage(100), text: '' },
        judge: { ...stage(10), correct: true, said: 'yes' },
      },
      // Filed but not yet asked: its missing stages don't pull their means down.
      { question: 'b', type: 'multi-session', filing: stage(3000) },
    ],
    10,
  )
  expect(projection.perStage).toEqual({ filing: 2000, reply: 100, judge: 10 })
  expect(projection.total).toBe(21_100)
})

test('a long history is marked compacted, so the reply model sees memory and the latest turns, not the haystack', async () => {
  const sessions = Array.from({ length: 40 }, (_, index) => ({
    id: `s${index}`,
    at: Date.UTC(2023, 0, 1 + index),
    evidence: false,
    turns: Array.from({ length: 6 }, (_, turn) => ({
      role: turn % 2 ? ('assistant' as const) : ('user' as const),
      text: `Session ${index} turn ${turn}. ${'Some ordinary chat about the weather and lunch. '.repeat(8)}`,
      hasAnswer: false,
    })),
  }))
  const question: Question = {
    id: 'long',
    type: 'multi-session',
    question: 'What is the weather like?',
    answer: 'Wet.',
    asked: Date.UTC(2023, 5, 1),
    sessions,
  }
  const { access, sent } = scripted({
    reply: () => fauxAssistantMessage('Wet.'),
  })
  const run = openRun(join(directory, 'run'), key)
  await runQuestion(question, {
    run,
    access,
    root: createMeter(Infinity),
    scratch: directory,
  })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('Session 39 turn 4')
  expect(sent[0]).not.toContain('Session 0 turn')
  expect(sent[0]).not.toContain('Session 20 turn')
})

/** Five one-session questions, so a set is bigger than the three that are measured first. */
const tiny = (id: string): Question => ({
  id,
  type: 'multi-session',
  question: `What did I say in ${id}?`,
  answer: 'Hello.',
  asked: Date.UTC(2023, 0, 10),
  sessions: [
    {
      id: `${id}-s`,
      at: Date.UTC(2023, 0, 5),
      evidence: true,
      turns: [
        { role: 'user', text: `Hello from ${id}.`, hasAnswer: true },
        { role: 'assistant', text: 'Hi there.', hasAnswer: false },
      ],
    },
  ],
})
const ids = ['a', 'b', 'c', 'd', 'e']
const LIMIT_MESSAGE =
  'You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.'

function setOf(overrides: Partial<SetOptions> & { limited: { on: boolean } }) {
  const { limited, ...rest } = overrides
  const { access, calls } = scripted({
    reply: () =>
      limited.on
        ? fauxAssistantMessage([], {
            stopReason: 'error',
            errorMessage: LIMIT_MESSAGE,
          })
        : fauxAssistantMessage('Hello.'),
  })
  const log: string[] = []
  const options: SetOptions = {
    ids,
    question: tiny,
    run: openRun(join(directory, `run-${Math.random()}`), key),
    access,
    maxTokens: 1_000_000_000,
    parallel: 4,
    wait: false,
    projectionOnly: false,
    scratch: directory,
    command: 'pnpm eval:longmem --set dev',
    log: (message) => log.push(message),
    ...rest,
  }
  return { options, log, calls }
}

test('a usage limit stops a set with what finished, what is left and the command, then a rerun finishes it', async () => {
  const limited = { on: true }
  const { options, log, calls } = setOf({ limited })
  const stopped = await runSet(options)
  expect(stopped.status).toBe('limit')
  expect(stopped.left).toEqual(ids)
  expect(log.join('\n')).toContain('pnpm eval:longmem --set dev')
  expect(log.join('\n')).toContain('Finished 0 of 5; 5 left')
  // The limit judged nothing, so nothing was graded wrong.
  expect(options.run.all().filter((saved) => saved.judge)).toEqual([])
  expect(calls.judge).toBe(0)

  limited.on = false
  const finished = await runSet(options)
  expect(finished).toMatchObject({ status: 'done', left: [] })
  expect(options.run.all().every((saved) => saved.judge?.correct)).toBe(true)
  // Filing was kept: it ran once per question, not once more per rerun.
  expect(calls.memory).toBeGreaterThan(0)
  const memoryCalls = calls.memory
  await runSet(options)
  expect(calls.memory).toBe(memoryCalls)
})

test("--wait sleeps until the limit lifts, by the provider's own time, and carries on", async () => {
  const limited = { on: true }
  const sleeps: number[] = []
  const { options } = setOf({
    limited,
    wait: true,
    sleep: async (ms) => {
      sleeps.push(ms)
      limited.on = false
    },
  })
  const outcome = await runSet(options)
  expect(outcome.status).toBe('done')
  expect(sleeps).toHaveLength(1)
  expect(sleeps[0]).toBeGreaterThan(89 * 60_000)
  expect(sleeps[0]).toBeLessThan(92 * 60_000)
})

test('the first questions project the whole set, and a projection past the cap stops it', async () => {
  const projecting = setOf({ limited: { on: false }, projectionOnly: true })
  expect((await runSet(projecting.options)).status).toBe('projected')
  expect(projecting.log.join('\n')).toMatch(
    /Projected for the 2 left: [\d,]+ tokens/,
  )
  expect(projecting.options.run.all()).toHaveLength(SAMPLE)

  const capped = setOf({ limited: { on: false }, maxTokens: 1 })
  expect((await runSet(capped.options)).status).toBe('over-cap')
  expect(capped.options.run.all().filter((saved) => saved.judge)).toHaveLength(
    0,
  )
})
