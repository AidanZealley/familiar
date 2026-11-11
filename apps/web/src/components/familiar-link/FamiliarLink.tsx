import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { dialogSearch, pushedState } from '@/lib/dialogs'
import { useWorkspace } from '@/lib/familiar'
import type { FamiliarLinkProps } from './types'

/** A Familiar's name, or portrait, opening its settings; plain once it's removed. */
export const FamiliarLink = ({
  id,
  then,
  children,
  className,
}: FamiliarLinkProps) => {
  const name = useWorkspace((state) => state.familiars?.familiars[id]?.name)

  if (name === undefined) {
    return (
      <span className={className}>
        {children ?? then ?? 'Removed Familiar'}
      </span>
    )
  }
  return (
    <Link
      to="."
      search={dialogSearch({ kind: 'familiar', id })}
      state={(previous) => pushedState(previous)}
      aria-label={children ? `${name} settings` : undefined}
      className={cn(!children && 'font-medium hover:underline', className)}
    >
      {children ?? name}
    </Link>
  )
}
