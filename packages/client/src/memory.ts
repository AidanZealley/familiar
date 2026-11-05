import type { CORE_BUDGET as CoreBudget } from '@familiar-ai/core/http'

/**
 * Core memory's limit in characters, measured as the model sees the facts:
 * `id: text`, one per line. Typed against core's without loading its
 * runtime, so a change there fails this check until the client follows.
 */
export const CORE_BUDGET: typeof CoreBudget = 6_000
