import type { Author } from '@familiar-ai/core'

export type ChatProps = {
  /** Who this client's session signed in. */
  author: Author
  people: Author[]
}
