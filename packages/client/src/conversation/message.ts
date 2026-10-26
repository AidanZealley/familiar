import type { MESSAGE_KIND as CoreMessageKind } from '@familiar/core/http'

// The client shares core's wire type without loading its runtime.
export const MESSAGE_KIND: typeof CoreMessageKind = 'familiar.message'
