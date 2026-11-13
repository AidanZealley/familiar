import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AssistantMessageEventStream,
  Provider,
  Usage,
} from '@earendil-works/pi-ai'
import type { ModelChoice } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { fileCredentialStore } from '@familiar-ai/core/node'
import { evalDirectory } from './longmem-data.ts'

/**
 * Model access for the model-backed memory evals: the eval's own ChatGPT
 * sign-in (never the owner's), an OpenAI API key for the paper's judge, and a
 * meter that counts every response's tokens, stops the run past a cap, and
 * stops it cleanly when the provider says a usage or rate limit has been
 * reached.
 *
 * A model is named `openai/modelId`.
 */

/** Upkeep and the reply run through the eval's sign-in unless told otherwise. */
export const MEMORY_MODEL = 'openai/gpt-6-luna'
export const REPLY_MODEL = 'openai/gpt-6.1-sol'
/** The judge the published LongMemEval scores use; it needs `OPENAI_API_KEY`. */
export const PAPER_JUDGE = 'openai/gpt-4o-2024-08-06'

/** Input plus output, cache reads and writes included. */
export const DEFAULT_MAX_TOKENS = 100_000_000

/** The eval's own ChatGPT sign-in, made with `FAMILIAR_DATA_DIR=<eval directory> pnpm sign-in`. */
const authFile = (home = homedir()) => join(evalDirectory(home), 'auth.json')

export type ModelSpec = { provider: 'openai'; modelId: string }

/** `openai/modelId`. */
export function parseModel(spec: string): ModelSpec {
  const [provider, ...rest] = spec.split('/')
  if (provider !== 'openai' || !rest.length) {
    throw new Error(`A model is named openai/<model>, not "${spec}".`)
  }
  return { provider, modelId: rest.join('/') }
}

/** Upkeep and the reply run at these levels, as a Familiar's own models would. */
export const choiceOf = (
  spec: string,
  thinkingLevel: ModelChoice['thinkingLevel'],
): ModelChoice => ({ model: parseModel(spec), thinkingLevel })

/** The provider said a usage or rate limit has been reached, not that the request was wrong. */
export class UsageLimitError extends Error {
  /** When the provider says the limit lifts, in ms since the epoch, if it says. */
  resetAt?: number
  constructor(message: string, resetAt?: number) {
    super(message)
    this.resetAt = resetAt
  }
}

/** The run passed its token cap; the meter stopped it. */
export class TokenCapError extends Error {}

const LIMIT =
  /usage.?limit|rate.?limit|too many requests|insufficient_quota|quota|(?<![a-z0-9])429(?![a-z0-9])/i

/** `6m0s`, `1h2m`, `20s`, `1.5s`, in ms. */
function durationIn(text: string) {
  const match = /(?:(\d+)h)?(?:(\d+)m(?!in))?(?:(\d+(?:\.\d+)?)s)?/.exec(text)
  if (!match || !match[0]) {
    return undefined
  }
  const [, hours = '0', minutes = '0', seconds = '0'] = match
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000
}

/**
 * Whether a provider's error message is a usage or rate limit, and when it
 * says the limit lifts: ChatGPT's "Try again in ~90 min", OpenAI's "Please
 * try again in 6m0s", a `resets_at` in seconds, or a `retry-after`. Other
 * failures, such as a server error or a bad key, are not limits.
 */
export function classifyLimit(
  message: string | undefined,
  now: number,
): { resetAt?: number } | undefined {
  if (!message || !LIMIT.test(message)) {
    return undefined
  }
  const minutes = /try again in ~?(\d+(?:\.\d+)?) ?min/i.exec(message)
  if (minutes) {
    return { resetAt: now + Number(minutes[1]) * 60_000 }
  }
  const after = /(?:try again|retry) (?:in|after) ([\dhms.]+)/i.exec(message)
  const waited = after && durationIn(after[1].replace(/\.+$/, ''))
  if (waited) {
    return { resetAt: now + waited }
  }
  const header = /retry-after"?[:= ]+(\d+)/i.exec(message)
  if (header) {
    return { resetAt: now + Number(header[1]) * 1000 }
  }
  const resets = /resets_at"?[:= ]+(\d{9,})/i.exec(message)
  if (resets) {
    return { resetAt: Number(resets[1]) * 1000 }
  }
  return {}
}

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export const noTokens = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
})

export const addTokens = (a: TokenTotals, b: TokenTotals): TokenTotals => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  total: a.total + b.total,
})

/** What a meter reports into. */
type Parent = {
  signal: AbortSignal
  count(usage: Usage): void
  trip(reason: Error): void
}

export type Meter = Parent & {
  totals(): TokenTotals
  check(): void
  stopped: Promise<never>
  wrap(provider: Provider): Provider
}

/**
 * Counts the usage of every response from the providers it wraps. Once the
 * total passes `cap` tokens, or a response says a limit has been reached, it
 * aborts their requests, in flight and new, and `check` throws, so the run
 * stops at its next check. A meter reports into its `parent`, so a stage can
 * be measured alone inside a run that has one cap and stops as one.
 */
export function createMeter(
  cap: number,
  { parent }: { parent?: Parent } = {},
): Meter {
  const totals = noTokens()
  const stop = new AbortController()
  const signal = parent
    ? AbortSignal.any([stop.signal, parent.signal])
    : stop.signal

  /** Stops this meter and everything it reports into. */
  const trip = (reason: Error) => {
    if (!stop.signal.aborted) {
      stop.abort(reason)
    }
    parent?.trip(reason)
  }

  const stopped = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
  })
  // Only a race against it reads the rejection; a stop nobody races is not an error.
  stopped.catch(() => {})

  const count = (usage: Usage | undefined) => {
    if (!usage) {
      return
    }
    parent?.count(usage)
    totals.input += usage.input
    totals.output += usage.output
    totals.cacheRead += usage.cacheRead
    totals.cacheWrite += usage.cacheWrite
    totals.total =
      totals.input + totals.output + totals.cacheRead + totals.cacheWrite
    if (totals.total > cap) {
      trip(
        new TokenCapError(
          `Stopped at ${totals.total.toLocaleString()} tokens, past the cap of ${cap.toLocaleString()}.`,
        ),
      )
    }
  }

  const counted = (stream: AssistantMessageEventStream) => {
    // The final message, done or failed, carries the response's usage.
    stream.result().then(
      (message) => {
        count(message.usage)
        const limit =
          message.stopReason === 'error'
            ? classifyLimit(message.errorMessage, Date.now())
            : undefined
        if (limit) {
          trip(
            new UsageLimitError(
              message.errorMessage ?? 'A usage limit was reached.',
              limit.resetAt,
            ),
          )
        }
      },
      () => {},
    )
    return stream
  }

  const signalFor = (other?: AbortSignal) =>
    other ? AbortSignal.any([other, signal]) : signal

  return {
    signal,
    count,
    trip,
    /** Tokens counted so far. */
    totals: (): TokenTotals => ({ ...totals }),
    /** Throws the limit or cap that stopped the run, once one has. */
    check() {
      if (signal.aborted) {
        throw signal.reason
      }
    },
    /** Rejects when the meter stops the run, so a wait for work can't outlast it. */
    stopped,
    /** `provider`, with every response counted and stopped past a cap or limit. */
    wrap: (provider: Provider): Provider => ({
      ...provider,
      stream: (model, context, options) =>
        counted(
          provider.stream(model, context, {
            ...options,
            signal: signalFor(options?.signal),
          } as typeof options),
        ),
      streamSimple: (model, context, options) =>
        counted(
          provider.streamSimple(model, context, {
            ...options,
            signal: signalFor(options?.signal),
          }),
        ),
    }),
  }
}

/** A provider that takes `apiKey` and nothing else, so no ambient credential is used. */
const keyed = (provider: Provider, name: string, apiKey: string): Provider => ({
  ...provider,
  auth: {
    apiKey: {
      name,
      resolve: async () => ({ auth: { apiKey }, source: 'eval key' }),
    },
  },
})

/** What the evals need to run models: three choices and a way to reach each stage's models. */
export type EvalAccess = {
  /** The names recorded in results. */
  names: { memory: string; reply: string; judge: string }
  memory: ModelChoice
  reply: ModelChoice
  judge: ModelChoice
  /** Models for filing or a reply, counted by `meter`. */
  models(meter: Meter): ReturnType<typeof createModels>
  /** Models for the judge, counted by `meter`. */
  judgeModels(meter: Meter): ReturnType<typeof createModels>
}

export type AccessOptions = {
  model?: string
  memoryModel?: string
  /** Defaults to the reply model. */
  judge?: string
}

/**
 * Access through the eval's ChatGPT sign-in, and the judge through
 * `OPENAI_API_KEY` when it is the paper's. Everything is checked before
 * anything reaches the network: the sign-in exists and each model is one the
 * provider lists.
 */
export function evalAccess(
  {
    model = REPLY_MODEL,
    memoryModel = MEMORY_MODEL,
    judge = model,
  }: AccessOptions = {},
  env = process.env,
  home = homedir(),
): EvalAccess {
  const file = authFile(home)
  let signedIn = false
  try {
    signedIn = 'openai' in JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // Missing or unreadable reads as not signed in.
  }
  if (!signedIn) {
    throw new Error(
      `The eval has no ChatGPT sign-in. Run FAMILIAR_DATA_DIR=${evalDirectory(home)} pnpm sign-in.`,
    )
  }
  // Shared across stages: it rewrites its file as tokens refresh, so each
  // must not hold its own copy.
  const chatgpt = fileCredentialStore(file)
  const signIn = (meter: Meter) => {
    const models = createModels({ credentials: chatgpt })
    models.setProvider(meter.wrap(openaiProvider()))
    return models
  }
  const keyFile = join(evalDirectory(home), 'openai-api-key')
  const apiKey = () => {
    const key =
      env.OPENAI_API_KEY?.trim() ||
      (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '')
    if (!key) {
      throw new Error(
        `${judge} is judged through an API key. Set OPENAI_API_KEY, or save an eval-only key in ${keyFile}; or pass --judge ${model} to judge with the reply model.`,
      )
    }
    return key
  }
  const key = judge === PAPER_JUDGE ? apiKey() : undefined
  const access: EvalAccess = {
    names: { memory: memoryModel, reply: model, judge },
    memory: choiceOf(memoryModel, 'low'),
    reply: choiceOf(model, 'medium'),
    judge: choiceOf(judge, 'low'),
    models: signIn,
    judgeModels: (meter) => {
      if (key === undefined) {
        return signIn(meter)
      }
      const models = createModels()
      models.setProvider(
        meter.wrap(keyed(openaiProvider(), 'Eval-only OpenAI API key', key)),
      )
      return models
    },
  }
  const probe = signIn(createMeter(0))
  for (const { model: ref } of [access.memory, access.reply, access.judge]) {
    if (!probe.getModel(ref.provider, ref.modelId)) {
      throw new Error(`openai has no model ${ref.modelId}.`)
    }
  }
  return access
}
