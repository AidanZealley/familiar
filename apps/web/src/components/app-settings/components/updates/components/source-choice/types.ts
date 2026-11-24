import type { UpdateSource } from '@/lib/updates'

export type SourceChoiceProps = {
  /** Where the installation updates from now, listed first. */
  current: UpdateSource
  chosen: UpdateSource
  onChoose: (source: UpdateSource) => void
  /** The version running, to mark a source that offers it. */
  version: string
  /** The latest version of each source, where known. */
  available?: Partial<Record<UpdateSource, string>>
}
