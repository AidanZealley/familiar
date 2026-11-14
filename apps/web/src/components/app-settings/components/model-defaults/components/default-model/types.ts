import type { ModelOption, ModelSetting } from '@familiar-ai/client'
import type { ReactNode } from 'react'

export type DefaultModelProps = {
  label: string
  description: ReactNode
  options: ModelOption[]
  value: Required<ModelSetting>
  /** A model alone runs at its own level. */
  onChange: (setting: ModelSetting) => void
  disabled?: boolean
}
