import type { Fact } from '@familiar/client'
import type { LucideIcon } from 'lucide-react'

export type FactListProps = {
  title: string
  icon: LucideIcon
  /** A line under the heading saying what the group means. */
  description: string
  facts: Fact[]
}
