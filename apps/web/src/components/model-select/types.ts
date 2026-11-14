import type { ModelOption, ModelRef } from '@familiar-ai/client'

export type ModelSelectProps = {
  /** What it may be set to. */
  options: ModelOption[]
  /** The one chosen; `null` follows `fallback`. */
  value: ModelRef | null
  /** What it runs on unless one is chosen; offered as "Default". */
  fallback?: ModelRef
  /** The model picked, or `null` for the default. */
  onChange: (model: ModelRef | null) => void
  disabled?: boolean
}
