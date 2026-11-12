import { CrownIcon } from '@phosphor-icons/react'

/**
 * A room lead's crown, on the corner of its portrait. Its parent must be
 * positioned (`relative`); the badge hangs off the bottom right.
 */
export const LeadBadge = () => (
  <span
    title="Leads this room"
    className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center border border-background bg-primary text-primary-foreground"
  >
    <CrownIcon aria-hidden weight="fill" className="size-2.5" />
  </span>
)
