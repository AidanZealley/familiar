import { cn } from 'cn'
import { ArchiveIcon, PinIcon, PinOffIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { familiar } from '@/lib/familiar'
import { CORE_IMPORTANCE, isPast } from '@/lib/memory'
import type { SavedFactProps } from './types'

const standing = (fact: SavedFactProps['fact']) =>
  isPast(fact)
    ? 'Since changed or no longer true'
    : fact.pinned
      ? 'Pinned in core'
      : fact.core
        ? `In core: importance ${fact.importance} of 5`
        : fact.importance < CORE_IMPORTANCE
          ? `In reserve: importance ${fact.importance} of 5`
          : 'In reserve: core is full'

/**
 * A fact a reply saved. Opening it shows the whole fact and lets the owner
 * correct it right where it came up.
 */
export const SavedFact = ({ fact }: SavedFactProps) => {
  const [error, setError] = useState<string>()
  const run = (action: Promise<void>) => {
    setError(undefined)
    action.catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }
  const store = familiar.getState()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'max-w-full truncate rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-left text-xs hover:bg-muted',
            isPast(fact) && 'border-border bg-transparent line-through',
          )}
        >
          {fact.text}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-sm font-normal text-foreground">
              {fact.text}
            </DropdownMenuLabel>
            <DropdownMenuLabel className="pt-0 font-heading text-[0.65rem] text-muted-foreground">
              {standing(fact)}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {!isPast(fact) && (
            <>
              <DropdownMenuSeparator />
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
              <DropdownMenuItem
                variant="destructive"
                onClick={() => run(store.forgetFact(fact.id))}
              >
                <Trash2Icon />
                Forget
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  )
}
