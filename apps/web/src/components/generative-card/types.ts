import type { CardDetails } from '@/cards/catalog'

export type GenerativeCardProps = CardDetails & {
  /** Whose card it is: its controls run that Familiar's tools. */
  familiar: number
}
