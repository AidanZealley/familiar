import type { CardDetails } from '@/cards/catalog'

export type GenerativeCardProps = CardDetails & {
  /** Whose card it is: its controls run that Familiar's tools. */
  familiar: number
  /**
   * Which call this card is, once its reply is posted: sent with each run
   * so the transcript draws the run as part of this card, not as a row.
   */
  card?: { entry: number; call: string }
}
