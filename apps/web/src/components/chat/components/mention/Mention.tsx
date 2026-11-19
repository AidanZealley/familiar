import type { MentionProps } from './types'

export const Mention = ({ children }: MentionProps) => (
  <span className="bg-primary/25 box-decoration-clone px-0.5 font-medium dark:bg-primary/70">
    {children}
  </span>
)
