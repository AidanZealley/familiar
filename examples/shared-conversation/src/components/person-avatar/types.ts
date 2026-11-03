import type { Author } from '@familiar-ai/core'

export type PersonAvatarProps = {
  /** Old messages may name their author without an ID. */
  author: Author | { name: string }
}
