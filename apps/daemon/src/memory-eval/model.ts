import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AssistantMessageEventStream,
  Provider,
  Usage,
} from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import type { ChatModel } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'

/**
 * Model access for the model-backed memory evals: Anthropic's API with a key
 * kept for evals only, never the owner's sign-in, and a meter that counts
 * every response's tokens and stops the run past a cap.
 */

/** Cheap enough to iterate on; `--model` picks another Anthropic model. */
export const EVAL_MODEL = 'claude-haiku-5-5'

/** Input plus output, cache reads and writes included. */
export const DEFAULT_MAX_TOKENS = 1_500_000

/** Where the eval-only key lives when `ANTHROPIC_API_KEY` isn't set. */
export const keyFile = (home = homedir()) =>
  join(home, '.local/share/familiar-eval/anthropic-api-key')

/**
 * The eval's Anthropic key: `ANTHROPIC_API_KEY`, else the key file. Throws,
 * naming both, when neither has one, before anything reaches the network.
 */
export function readApiKey(env = process.env, file = keyFile()) {
  const key =
    env.ANTHROPIC_API_KEY?.trim() ||
    (existsSync(file) ? readFileSync(file, 'utf8').trim() : '')
  if (!key) {
    throw new Error(
      `No Anthropic API key for the eval. Set ANTHROPIC_API_KEY, or save an eval-only key in ${file}.`,
    )
  }
  return key
}

/**
 * The model upkeep runs on: Anthropic's `modelId` at low thinking. The one
 * place its identity is decided, so the fixture lookup and the saved hash
 * can't differ.
 */
export const upkeepModel = (modelId = EVAL_MODEL): ChatModel => ({
  model: { provider: 'anthropic', modelId },
  thinkingLevel: 'low',
})

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

/** The run passed its token cap; the meter stopped it. */
export class TokenCapError extends Error {}

export type Meter = ReturnType<typeof createMeter>

/**
 * Counts the usage of every response from the providers it wraps. Once the
 * total passes `cap`, it aborts their requests, in flight and new, and
 * `check` throws, so the run stops at its next check.
 */
export function createMeter(cap: number) {
  const totals: TokenTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }
  const stop = new AbortController()

  const count = (usage: Usage | undefined) => {
    if (!usage) {
      return
    }
    totals.input += usage.input
    totals.output += usage.output
    totals.cacheRead += usage.cacheRead
    totals.cacheWrite += usage.cacheWrite
    totals.total =
      totals.input + totals.output + totals.cacheRead + totals.cacheWrite
    if (totals.total > cap && !stop.signal.aborted) {
      stop.abort(
        new TokenCapError(
          `Stopped at ${totals.total.toLocaleString()} tokens, past the cap of ${cap.toLocaleString()}.`,
        ),
      )
    }
  }

  const counted = (stream: AssistantMessageEventStream) => {
    // The final message, done or failed, carries the response's usage.
    stream.result().then(
      (message) => count(message.usage),
      () => {},
    )
    return stream
  }

  const signalFor = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([signal, stop.signal]) : stop.signal

  return {
    cap,
    /** Tokens counted so far. */
    totals: (): TokenTotals => ({ ...totals }),
    /** The whole run's tokens if the rest costs what `done` of `all` steps did. */
    projection: (done: number, all: number) =>
      done ? Math.round((totals.total / done) * all) : 0,
    /** Throws a TokenCapError once the cap has been passed. */
    check() {
      if (stop.signal.aborted) {
        throw stop.signal.reason
      }
    },
    /** `provider`, with every response counted and stopped past the cap. */
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

/**
 * Models with only Anthropic's provider, authenticated by `apiKey` alone, so
 * no ambient credential or sign-in can be used, and metered. Returns the
 * memory model at low thinking, for `WorkspaceOptions.memoryModel` or as a
 * chat model. A run adds any scripted providers it needs to `models`.
 */
export function evalModels({
  apiKey,
  modelId = EVAL_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
}: {
  apiKey: string
  modelId?: string
  maxTokens?: number
}) {
  const meter = createMeter(maxTokens)
  const anthropic = anthropicProvider()
  const models = createModels()
  models.setProvider(
    meter.wrap({
      ...anthropic,
      auth: {
        apiKey: {
          name: 'Eval-only Anthropic API key',
          resolve: async () => ({ auth: { apiKey }, source: 'eval key' }),
        },
      },
    }),
  )
  const model = upkeepModel(modelId)
  if (!models.getModel(model.model.provider, modelId)) {
    throw new Error(`Anthropic has no model ${modelId}.`)
  }
  return { models, model, meter }
}
