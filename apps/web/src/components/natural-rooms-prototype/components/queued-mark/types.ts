import type { Turn } from '../../timeline'

export type QueuedMarkProps = {
  /** Familiars that have the message queued and haven't picked it up. */
  waiting: Turn[]
}
