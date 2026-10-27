import type {
  CompactionSettings,
  HarnessOptions,
  Registry,
} from '@earendil-works/pi-durable'
import type { FamiliarOptions } from '../familiar.ts'

export const DEFAULT_CONTEXT_BUDGET = 64_000

/** How long a model response may go silent before it fails and is retried. */
export const STREAM_TIMEOUT_MS = 180_000

/**
 * Compaction thresholds that keep requests under `budget`. Pi measures from
 * the top of the window, so the budget becomes the room reserved below it.
 * A window smaller than the budget keeps a quarter of itself free instead.
 */
export function compactionFor(
  contextWindow: number,
  budget: number,
): CompactionSettings {
  const limit = Math.min(budget, Math.floor(contextWindow * 0.75))
  return {
    // Above `contextWindow - reserveTokens`, the next request waits to compact.
    reserveTokens: contextWindow - limit,
    // What stays verbatim after compacting, leaving room to grow before the next.
    keepRecentTokens: Math.floor(limit / 3),
    // Starts compacting in the background at three quarters of the limit, so a
    // request rarely has to wait for it.
    backgroundTokens: Math.floor(limit / 4),
  }
}

export function harnessOptions(
  options: FamiliarOptions,
  registry: Registry,
  budget: number,
): HarnessOptions {
  // Looked up at each open, so a change of model gets its own thresholds.
  const window = options.models.getModel(
    options.model.provider,
    options.model.modelId,
  )?.contextWindow
  return {
    models: options.models,
    registry,
    settings: {
      compaction: window ? compactionFor(window, budget) : undefined,
      // Without a limit, a stream that goes silent waits forever and blocks
      // its conversation. Over WebSockets this is the longest silence allowed;
      // over SSE, the longest wait for headers. Long enough for slow reasoning.
      stream: { timeoutMs: STREAM_TIMEOUT_MS },
    },
    ...(options.now && { now: options.now }),
    ...(options.setTimer && { setTimer: options.setTimer }),
  }
}
