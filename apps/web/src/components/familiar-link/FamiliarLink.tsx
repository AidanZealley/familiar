import { cn } from 'cn'
import { openDialog } from '@/lib/dialogs'
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
    <button
      type="button"
      onClick={() => openDialog({ kind: 'familiar', id })}
      aria-label={children ? `${name} settings` : undefined}
      className={cn(
        'text-left',
        !children && 'font-medium hover:underline',
        className,
      )}
    >
      {children ?? name}
    </button>
  )
}
