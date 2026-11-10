import { useMutation } from '@tanstack/react-query'
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
import type { FactMenuProps } from './types'

/** A current fact's actions. Their failures show under the fact. */
export const FactMenu = ({ fact, onEdit }: FactMenuProps) => {
  const setPinned = useMutation({
    mutationKey: ['fact', fact.id],
    mutationFn: (pinned: boolean) =>
      familiar().memory.setPinned(fact.id, pinned),
  })
  const retire = useMutation({
    mutationKey: ['fact', fact.id],
    mutationFn: () => familiar().memory.retire(fact.id),
  })

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
        <DropdownMenuItem onClick={onEdit}>
          <PencilIcon />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPinned.mutate(!fact.pinned)}>
          {fact.pinned ? <PinOffIcon /> : <PinIcon />}
          {fact.pinned ? 'Unpin from core' : 'Pin to core'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => retire.mutate()}>
          <ArchiveIcon />
          No longer true
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
