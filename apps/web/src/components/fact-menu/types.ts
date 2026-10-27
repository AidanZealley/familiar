import type { Fact } from '@familiar/client'

export type FactMenuProps = {
  fact: Fact
  /** Without it, the menu offers no Edit. */
  onEdit?: () => void
  /** Why an action was refused, such as pinning when core is full. */
  onError: (message: string) => void
}
