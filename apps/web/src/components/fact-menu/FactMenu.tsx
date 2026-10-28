import {
  ArchiveIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { familiar } from '@/lib/familiar'
import { isPast } from '@/lib/memory'
import type { FactMenuProps } from './types'

/** A current fact's actions. Past facts are history, so they have none. */
export const FactMenu = ({ fact, onEdit, onError }: FactMenuProps) => {
  const run = (action: Promise<void>) =>
    action.catch((cause) =>
      onError(cause instanceof Error ? cause.message : String(cause)),
    )
  const store = familiar.getState()

  if (isPast(fact)) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Fact actions" />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => run(store.setFactPinned(fact.id, !fact.pinned))}
        >
          {fact.pinned ? <PinOffIcon /> : <PinIcon />}
          {fact.pinned ? 'Unpin from core' : 'Pin to core'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run(store.retireFact(fact.id))}>
          <ArchiveIcon />
          No longer true
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
