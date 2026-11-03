import type { Author } from '@familiar-ai/core'

export type PersonSwitcherProps = {
  people: Author[]
  /** The ID of the person sending. */
  value: string
  onValueChange: (id: string) => void
}
