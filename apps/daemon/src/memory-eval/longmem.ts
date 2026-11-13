import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { nextUpkeep } from '@familiar-ai/core/diagnostics'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { replyTo } from '../reply.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { createClock, EVAL_TIME_ZONE } from './clock.ts'
import type { Question } from './longmem-data.ts'
import {
  CONTEXT_BUDGET,
  USER,
  writeHistory,
  type HistoryStore,
} from './longmem-history.ts'
import { judge } from './longmem-judge.ts'
import type { Run, Saved, Stage } from './longmem-run.ts'
import { createMeter, type EvalAccess, type Meter } from './model.ts'
import { replyText, settle, within } from './settle.ts'
import { upkeepThrough, waitForUpkeep } from './unfiled.ts'

/**
 * One LongMemEval question in a real workspace, in three stages that each
 * save their result as soon as they finish:
 *
 * 1. **Filing.** The whole haystack is written into the Familiar's
 *    conversation with its original dates, then memory's upkeep, on the
 *    memory model, files it as it would after the Familiar had been away.
 * 2. **Reply.** The question is asked in the same DM at its date, on a copy
 *    of the filed store, and the reply model answers over what memory holds.
 * 3. **Judge.** LongMemEval's judge prompts grade the reply.
 */

const HOUR = 60 * 60 * 1000
/** A reply that hasn't come by now never will. */
const REPLY_TIMEOUT = 5 * 60 * 1000

export type RunOptions = {
  run: Run
  access: EvalAccess
  /** The run's meter, which holds its cap and stops everything under it on a limit. */
  root: Meter
  /** A temporary directory for the reply stage's copy of the store. */
  scratch: string
  progress?: (message: string) => void
}

const stageOf = (meter: Meter, started: number): Stage => ({
  tokens: meter.totals(),
  elapsedMs: Date.now() - started,
})

/**
 * When upkeep's pass over the whole history runs: the first night after the
 * last message, or the last night before the question if that is later, so
 * the pass that follows is not due until after the question is asked.
 */
export function filingTime(lastAt: number, asked: number) {
  let night = nextUpkeep(lastAt, EVAL_TIME_ZONE)
  for (
    let next = nextUpkeep(night, EVAL_TIME_ZONE);
    next <= asked;
    next = nextUpkeep(night, EVAL_TIME_ZONE)
  ) {
    night = next
  }
  return night
}

/** Writes and files `question`'s history at `store.path`. Throws if upkeep stopped short. */
export async function fileHistory(
  question: Question,
  store: HistoryStore,
  access: EvalAccess,
  meter: Meter,
) {
  const clock = createClock(store.lastAt)
  const night = filingTime(store.lastAt, question.asked)
  const sameModel = access.memory.model.modelId === access.reply.model.modelId
  const storage = await openNodeSqliteStorage(store.path)
  const { workspace } = await openDaemonWorkspace(
    {
      storage,
      models: access.models(meter),
      chatModel: access.reply.model,
      modelChoices: sameModel ? [access.reply] : [access.reply, access.memory],
      memoryModel: access.memory.model,
      timeZone: EVAL_TIME_ZONE,
      now: clock.now,
      setTimer: clock.setTimer,
    },
    'Familiar',
  )
  try {
    // The pass is scheduled a moment after opening; a clock moved before then would miss it.
    await waitForUpkeep(
      storage,
      clock,
      nextUpkeep(store.lastAt, EVAL_TIME_ZONE),
    )
    clock.advanceTo(night)
    await settle(workspace, clock, meter, night + HOUR)
  } finally {
    await workspace.dismiss()
  }

  const filed = await openNodeSqliteStorage(store.path)
  try {
    const through = await upkeepThrough(filed, store.familiar)
    const last = store.written.at(-1)?.entry
    if (last !== undefined && (through === null || through < last)) {
      throw new Error(
        `${question.id}: upkeep filed through entry ${through ?? 'none'}, short of the last message (entry ${last}), so it failed: check the sign-in and the models.`,
      )
    }
  } finally {
    await filed.close(BACKGROUND_CONTEXT)
  }
}

/** Asks `question` of a copy of the filed store at `path`, at its date, and returns the reply. */
export async function askQuestion(
  question: Question,
  path: string,
  access: EvalAccess,
  meter: Meter,
) {
  const clock = createClock(question.asked)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(path),
      models: access.models(meter),
      chatModel: access.reply.model,
      modelChoices: [access.reply],
      timeZone: EVAL_TIME_ZONE,
      contextBudget: CONTEXT_BUDGET,
      now: clock.now,
      setTimer: clock.setTimer,
    },
    'Familiar',
  )
  try {
    const dm = (await workspace.rooms.get(
      await workspace.rooms.dm(familiar, USER.id),
    ))!
    const entry = await dm.post({
      author: USER,
      text: question.question,
      requestId: `longmem:question:${question.id}`,
    })
    // Retries wait on the eval clock, so let it run to the next night.
    await settle(
      workspace,
      clock,
      meter,
      nextUpkeep(question.asked, EVAL_TIME_ZONE),
    )
    const answer = await within(
      REPLY_TIMEOUT,
      `${question.id} got no reply in time.`,
      replyTo(dm, entry),
      meter,
    )
    meter.check()
    if (answer.outcome === 'failed' || answer.outcome === 'stopped') {
      throw new Error(
        `${question.id} ${answer.outcome} without a reply: check the sign-in and the model.`,
      )
    }
    return answer.outcome === 'answered' ? replyText(answer.messages) : ''
  } finally {
    await workspace.dismiss()
  }
}

/**
 * Runs the stages of `question` that aren't saved yet, saving each as it
 * finishes. Throws a UsageLimitError or TokenCapError, with everything
 * before it saved, when the meter stops the run.
 */
export async function runQuestion(
  question: Question,
  { run, access, root, scratch, progress = () => {} }: RunOptions,
): Promise<Saved> {
  const saved: Saved = run.read(question.id) ?? {
    question: question.id,
    type: question.type,
  }
  const storePath = run.storePath(question.id)

  if (!saved.filing || !existsSync(storePath)) {
    // A filing that was cut short starts again: it is only kept once whole.
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${storePath}${suffix}`, { force: true })
    }
    delete saved.reply
    delete saved.judge
    const meter = createMeter(Infinity, { parent: root })
    const started = Date.now()
    progress(`${question.id}: filing`)
    try {
      const store = await writeHistory(storePath, question)
      await fileHistory(question, store, access, meter)
    } catch (error) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${storePath}${suffix}`, { force: true })
      }
      throw error
    }
    saved.filing = stageOf(meter, started)
    run.write(saved)
  }

  if (!saved.reply) {
    const meter = createMeter(Infinity, { parent: root })
    const started = Date.now()
    progress(`${question.id}: asking`)
    // On a copy, so a later ask over the same filing starts from the same memory.
    const copy = join(scratch, `${question.id}.sqlite`)
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${storePath}${suffix}`)) {
        copyFileSync(`${storePath}${suffix}`, `${copy}${suffix}`)
      }
    }
    try {
      const text = await askQuestion(question, copy, access, meter)
      saved.reply = { ...stageOf(meter, started), text }
      run.write(saved)
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${copy}${suffix}`, { force: true })
      }
    }
  }

  if (!saved.judge) {
    const meter = createMeter(Infinity, { parent: root })
    const started = Date.now()
    const verdict = await judge(
      access.judgeModels(meter),
      access.judge.model,
      question,
      saved.reply.text,
    )
    meter.check()
    saved.judge = { ...stageOf(meter, started), ...verdict }
    run.write(saved)
    progress(
      `${question.id}: ${verdict.correct ? 'correct' : 'wrong'} (${root.totals().total.toLocaleString()} tokens so far)`,
    )
  }
  return saved
}
