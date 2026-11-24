import type { LastUpdate } from '@/lib/updates'

export type UpdateProgressProps = {
  /** The running update, or undefined while it's being started. */
  update?: LastUpdate
  /** The version it's updating to, where known before it's installed. */
  target?: string
  /** Whether the daemon answers: not while it restarts. */
  reachable: boolean
}
