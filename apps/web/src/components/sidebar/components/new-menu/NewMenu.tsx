import { HashIcon, PlusIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDialog } from '@/lib/dialogs'
import type { NewMenuProps } from './types'

/** Makes a Familiar, or a room for several. */
export const NewMenu = ({ className }: NewMenuProps) => {
  const { open } = useDialog()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="New"
            className={className}
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => open({ kind: 'new-familiar' })}>
          <SparklesIcon />
          New Familiar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => open({ kind: 'new-room' })}>
          <HashIcon />
          New room
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
