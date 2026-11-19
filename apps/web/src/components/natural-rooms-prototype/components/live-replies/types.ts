import type { Turn } from '../../timeline'

export type LiveRepliesProps = {
  /** Familiars replying here now, each with its reply so far. */
  running: Extract<Turn, { status: 'running' }>[]
}
