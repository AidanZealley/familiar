import type { ReactNode } from 'react'

export type ProblemProps = {
  /** What went wrong, in a few words. */
  title: string
  /** Why, and what to do about it, when that's known. */
  description?: string
  /** A way out, such as a button to try again. */
  action?: ReactNode
  /** The underlying error's message, folded away under "Error details". */
  details?: string
  className?: string
}
