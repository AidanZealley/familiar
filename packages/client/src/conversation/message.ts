import type {
  MESSAGE_KIND as CoreMessageKind,
  SCHEDULED_KIND as CoreScheduledKind,
} from '@familiar-ai/core/http'

// The client shares core's wire types without loading its runtime.
export const MESSAGE_KIND: typeof CoreMessageKind = 'familiar.message'
export const SCHEDULED_KIND: typeof CoreScheduledKind = 'familiar.scheduled'
