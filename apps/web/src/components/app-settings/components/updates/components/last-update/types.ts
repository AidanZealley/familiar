import type { LastUpdate } from '@/lib/updates'

export type LastUpdateProps = {
  /** The last update, once it's over. */
  update: LastUpdate
  /** The version this page was loaded from, if the daemon has moved on. */
  reloadFor?: string
}
