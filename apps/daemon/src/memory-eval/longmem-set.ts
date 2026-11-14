import { setTimeout } from 'node:timers/promises'
import type { Question } from './longmem-data.ts'
import { projectTokens } from './longmem-report.ts'
import { isDone, type Run } from './longmem-run.ts'
import { runQuestion } from './longmem.ts'
import {
  createMeter,
  TokenCapError,
  UsageLimitError,
  type EvalAccess,
} from './model.ts'

/** The questions measured first, to project the whole run from. */
export const SAMPLE = 3
const MINUTE = 60_000

export type SetOptions = {
  ids: readonly string[]
  question(id: string): Question
  run: Run
  access: EvalAccess
  /** Stops the run past this many tokens; counted over this command, not what earlier runs saved. */
  maxTokens: number
  parallel: number
  /** Sleep through a usage limit and carry on, instead of stopping. */
  wait: boolean
  /** Stop after the projection. */
  projectionOnly: boolean
  scratch: string
  /** The command to continue with, for the message when a limit stops the run. */
  command: string
  log?: (message: string) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type SetOutcome = {
  /**
   * `done`: every question is judged. `limit`: a usage limit stopped it
   * cleanly. `over-cap`: the projection or the meter passed `maxTokens`.
   * `projected`: stopped after the projection, as asked.
   */
  status: 'done' | 'limit' | 'over-cap' | 'projected'
  left: string[]
  /** Tokens this command used. */
  used: number
}

const count = (tokens: number) => Math.round(tokens).toLocaleString()
const minutes = (ms: number) => `${(ms / MINUTE).toFixed(1)} min`

/** Runs `pool`'s work on every item, `size` at a time, stopping after the first failure. */
async function pool<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items]
  let failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (queue.length && failure === undefined) {
        try {
          await work(queue.shift()!)
        } catch (error) {
          failure ??= error
        }
      }
    }),
  )
  if (failure !== undefined) {
    throw failure
  }
}

/**
 * Runs what isn't saved of a set. First the first few questions, to project
 * the cost of the rest and stop if it is over the cap; then the rest. A
 * usage limit stops it with everything finished saved, or with `wait` sleeps
 * until the limit lifts and carries on. A limit is never a wrong answer: a
 * question it cuts short has no verdict, so it runs again.
 */
export async function runSet(options: SetOptions): Promise<SetOutcome> {
  const {
    ids,
    run,
    maxTokens,
    log = () => {},
    sleep = (ms) => setTimeout(ms),
    now = Date.now,
  } = options
  const pending = () => ids.filter((id) => !isDone(run.read(id)))
  let used = 0
  let projected = false
  let finished = 0
  let finishedAtLimit = 0
  let backoff = MINUTE

  /** One attempt at what's left, under a fresh meter. Throws what stopped it. */
  const attempt = async (): Promise<SetOutcome['status'] | undefined> => {
    const root = createMeter(maxTokens - used)
    const go = async (id: string) => {
      await runQuestion(options.question(id), {
        run,
        access: options.access,
        root,
        scratch: options.scratch,
        progress: log,
      })
      finished++
    }
    try {
      const left = pending()
      if (left.length > SAMPLE && !projected) {
        const sample = left.slice(0, SAMPLE)
        log(`Measuring the first ${sample.length} questions first.`)
        await pool(sample, sample.length, go)
        const rest = left.length - sample.length
        const projection = projectTokens(
          sample.map((id) => run.read(id)!),
          rest,
        )
        const total = used + root.totals().total + projection.total
        log(
          `\nMeasured ${sample.length}: ${count(root.totals().total)} tokens. Per question: filing ${count(projection.perStage.filing)}, reply ${count(projection.perStage.reply)}, judge ${count(projection.perStage.judge)} = ${count(projection.perQuestion)}.\nProjected for the ${rest} left: ${count(projection.total)} tokens, ${count(total)} with what is spent, against the cap of ${count(maxTokens)}.`,
        )
        projected = true
        if (options.projectionOnly) {
          return 'projected'
        }
        if (total > maxTokens) {
          log(
            'The projection is past --max-tokens, so the run stops here. Raise the cap, or choose a smaller set.',
          )
          return 'over-cap'
        }
      } else if (options.projectionOnly) {
        log('Nothing to project: three or fewer questions are left.')
        return 'projected'
      }
      await pool(pending(), options.parallel, go)
      return undefined
    } finally {
      used += root.totals().total
    }
  }

  for (;;) {
    try {
      const status = await attempt()
      if (status) {
        return { status, left: pending(), used }
      }
      return { status: 'done', left: pending(), used }
    } catch (error) {
      if (error instanceof TokenCapError) {
        log(`\n${error.message}`)
        return { status: 'over-cap', left: pending(), used }
      }
      if (!(error instanceof UsageLimitError)) {
        throw error
      }
      const left = pending()
      log(
        `\nA usage limit was reached: ${error.message}\nFinished ${ids.length - left.length} of ${ids.length}; ${left.length} left (${count(used)} tokens used by this command). Everything finished is saved in ${run.directory}.`,
      )
      if (!options.wait) {
        log(
          `${error.resetAt ? `The limit lifts about ${new Date(error.resetAt).toLocaleString()}. ` : ''}Continue with:\n  ${options.command}\nor add --wait to sleep until it lifts and carry on.`,
        )
        return { status: 'limit', left, used }
      }
      // Back off while nothing gets through between limits, up to an hour.
      backoff =
        finished > finishedAtLimit ? MINUTE : Math.min(backoff * 2, 60 * MINUTE)
      finishedAtLimit = finished
      const pause = error.resetAt
        ? Math.max(MINUTE, error.resetAt - now() + 30_000)
        : backoff
      log(
        `Waiting ${minutes(pause)}, until ${new Date(now() + pause).toLocaleString()}.`,
      )
      await sleep(pause)
    }
  }
}
