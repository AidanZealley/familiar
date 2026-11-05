import type { Fact } from '@familiar-ai/client'

export type MemoryOverviewProps = {
  /** Core's facts, as `coreFacts` gives them. */
  core: Fact[]
  /** The reserve's, as `reserveFacts` gives them. */
  reserve: Fact[]
}
