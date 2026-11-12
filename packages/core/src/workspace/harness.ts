import type {
  CompactionSettings,
  HarnessOptions,
  ModelRef,
  Registry,
} from '@earendil-works/pi-durable'
import { modelKey, type ModelChoice } from '../conversation/models.ts'
import type { WorkspaceOptions } from './index.ts'
import { UPKEEP_EXTENSION } from '../memory/upkeep/index.ts'

export const DEFAULT_CONTEXT_BUDGET = 64_000

/** How long a model response may go silent before it fails and is retried. */
const STREAM_TIMEOUT_MS = 180_000

/**
 * Compaction thresholds that keep requests under `budget`. Pi measures from
 * the top of the window, so the budget becomes the room reserved below it.
 * A window smaller than the budget keeps a quarter of itself free instead.
 */
function compactionFor(
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

/** Pi's options for this Familiar: its models, compaction, defaults and clock. */
export function harnessOptions(
  options: Pick<
    WorkspaceOptions,
    'models' | 'chatModel' | 'now' | 'setTimer' | 'onWake'
  > & { modelChoices: readonly ModelChoice[] },
  registry: Registry,
  budget: number,
): HarnessOptions {
  // Pi measures from the top of each model's own window, so every model the
  // conversation can switch to needs its own thresholds for the same budget.
  // Looked up at each open, so a change of models applies on restart.
  const compactionOf = (model: ModelRef) => {
    const window = options.models.getModel(
      model.provider,
      model.modelId,
    )?.contextWindow
    return window ? compactionFor(window, budget) : undefined
  }
  const base = compactionOf(options.chatModel)
  const modelOverrides = Object.fromEntries(
    options.modelChoices.flatMap(({ model }) => {
      const compaction = compactionOf(model)
      return compaction ? [[modelKey(model), compaction]] : []
    }),
  )
  return {
    models: options.models,
    registry,
    settings: {
      // What a conversation gets unless it chooses: every installed
      // extension, read each time so MCP servers added later reach chat,
      // except upkeep's. Its tools write facts directly, and upkeep is their
      // only writer, so only upkeep's own conversation selects them.
      get extensions() {
        return registry
          .snapshot()
          .installed()
          .filter((extension) => extension.name !== UPKEEP_EXTENSION)
      },
      compaction: base && { ...base, modelOverrides },
      // Without a limit, a stream that goes silent waits forever and blocks
      // its conversation. Over WebSockets this is the longest silence allowed;
      // over SSE, the longest wait for headers. Long enough for slow reasoning.
      stream: { timeoutMs: STREAM_TIMEOUT_MS },
      // Pi's default keeps inputs queued behind a failed run until the next
      // message, which would hold a due reminder back indefinitely.
      afterFailedRun: 'continue',
    },
    // Pi falls back to Date.now and setTimeout when these are undefined.
    now: options.now,
    setTimer: options.setTimer,
    // With it, Pi arms no timer for sleeping tasks and the host wakes it.
    onWake: options.onWake,
  }
}
