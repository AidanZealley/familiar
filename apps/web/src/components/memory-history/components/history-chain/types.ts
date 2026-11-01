import type { Fact } from '@familiar-ai/client'

export type HistoryChainProps = {
  /** Versions of one fact, oldest first. */
  chain: Fact[]
}
