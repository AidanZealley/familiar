import type { Turn } from '../../timeline'

export type TypingRowProps = {
  /** Familiars replying here now. */
  running: Turn[]
  /** Familiars with this room's message queued: dimmed, with why on hover. */
  waiting: Turn[]
}
