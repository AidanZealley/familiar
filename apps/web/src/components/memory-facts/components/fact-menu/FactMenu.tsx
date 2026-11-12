import { useMutation } from '@tanstack/react-query'
import {
  ArchiveIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFamiliarStore } from '@/lib/familiar'
import type { FactMenuProps } from './types'

/** A current fact's actions. Their failures show under the fact. */
export const FactMenu = ({ fact, onEdit }: FactMenuProps) => {
  const familiar = useFamiliarStore()
  const setPinned = useMutation({
    mutationKey: ['fact', fact.id],
    mutationFn: (pinned: boolean) => familiar.memory.setPinned(fact.id, pinned),
  })
  const retire = useMutation({
    mutationKey: ['fact', fact.id],
    mutationFn: () => familiar.memory.retire(fact.id),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Fact actions" />
        }
      >
        <DotsThreeVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onEdit}>
          <PencilSimpleIcon />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPinned.mutate(!fact.pinned)}>
          {fact.pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
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
