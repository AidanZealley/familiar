import type { Fact } from '@familiar-ai/client'
import type { Icon } from '@phosphor-icons/react'

export type FactSectionProps = {
  icon: Icon
  title: string
  /** What being in this section means for a fact. */
  description: string
  facts: Fact[]
}
