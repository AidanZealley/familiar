import type { Author } from '@familiar-ai/core'
import type { ReactNode } from 'react'

export type ChatProps = {
  /** Who this client's session signed in. */
  author: Author
  people: Author[]
  /** Shown above the suggestions, so choosing a sender sits with sending. */
  switcher: ReactNode
  /** Kept mounted and laid out while another person is chosen, with its draft. */
  hidden: boolean
}
