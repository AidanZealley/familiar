import type { Fact } from '@familiar/client'

export type HistoryChainProps = {
  /** Versions of one fact, oldest first. */
  chain: Fact[]
}
