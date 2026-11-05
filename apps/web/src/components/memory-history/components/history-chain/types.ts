import type { Fact } from '@familiar-ai/client'

export type HistoryChainProps = {
  /** Versions of one fact, newest first. */
  chain: Fact[]
}
