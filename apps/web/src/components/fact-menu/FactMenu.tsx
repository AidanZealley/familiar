import {
  ArchiveIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { familiar } from '@/lib/familiar'
import { isPast } from '@/lib/memory'
import type { FactMenuProps } from './types'

/** A fact's actions. A past fact can only be forgotten. */
export const FactMenu = ({ fact, onEdit, onError }: FactMenuProps) => {
  const run = (action: Promise<void>) =>
    action.catch((cause) =>
      onError(cause instanceof Error ? cause.message : String(cause)),
    )
  const store = familiar.getState()

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
        {!isPast(fact) && (
          <>
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
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={() => run(store.forgetFact(fact.id))}
        >
          <Trash2Icon />
          Forget
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
