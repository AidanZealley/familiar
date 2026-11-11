import {
  AlarmClockIcon,
  ArchiveIcon,
  BrainIcon,
  CrownIcon,
  EllipsisVerticalIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDialog } from '@/lib/dialogs'
import type { ConversationMenuProps } from './types'

/**
 * The room's, or the DM's Familiar's, settings and actions. Each opens its
 * category of the settings dialog, where it's explained and confirmed.
 */
export const ConversationMenu = ({
  room,
  className,
}: ConversationMenuProps) => {
  const { open } = useDialog()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="More"
            className={className}
          />
        }
      >
        <EllipsisVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {room.kind === 'dm' ? (
          <>
            <DropdownMenuItem
              onClick={() => open({ kind: 'familiar', id: room.familiar })}
            >
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                open({ kind: 'familiar', id: room.familiar }, 'memory')
              }
            >
              <BrainIcon />
              Memory
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                open({ kind: 'familiar', id: room.familiar }, 'schedules')
              }
            >
              <AlarmClockIcon />
              Schedules
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                open({ kind: 'familiar', id: room.familiar }, 'remove')
              }
            >
              <Trash2Icon />
              Remove…
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => open({ kind: 'room', id: room.id })}
            >
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => open({ kind: 'room', id: room.id }, 'members')}
            >
              <UsersIcon />
              Members
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => open({ kind: 'room', id: room.id }, 'lead')}
            >
              <CrownIcon />
              Lead
            </DropdownMenuItem>
            {!room.archived && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => open({ kind: 'room', id: room.id }, 'archive')}
                >
                  <ArchiveIcon />
                  Archive…
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
