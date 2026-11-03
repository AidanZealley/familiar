import type { Author } from '@familiar-ai/core'

export type ChatProps = {
  /** Who this client's session signed in. */
  author: Author
  /** Kept mounted and laid out while another person is chosen, with its scroll position. */
  hidden: boolean
}
