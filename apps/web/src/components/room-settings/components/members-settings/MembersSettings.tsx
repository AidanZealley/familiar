import { useMutation } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { FamiliarLink } from '@/components/familiar-link'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { workspace } from '@/lib/familiar'
import { useFamiliars } from '@/lib/workspace'
import type { MembersSettingsProps } from './types'

/** The room's Familiars, in order: move them, take them out, or add more. */
export const MembersSettings = ({ room }: MembersSettingsProps) => {
  const familiars = useFamiliars()
  const change = useMutation({
    mutationFn: (members: number[]) =>
      workspace.rooms.update(room.id, {
        familiars: members,
        // A lead taken out leaves the room open.
        ...(room.lead !== undefined &&
          !members.includes(room.lead) && { lead: null }),
      }),
  })
  const outside = familiars.filter(
    (familiar) => !room.familiars.includes(familiar.id),
  )
  const members = room.familiars.flatMap(
    (id) => familiars.find((familiar) => familiar.id === id) ?? [],
  )
  const move = (index: number, by: number) => {
    const next = [...room.familiars]
    const [moved] = next.splice(index, 1)
    next.splice(index + by, 0, moved!)
    change.mutate(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-1.5">
        {members.map((familiar, index) => (
          <Item key={familiar.id} variant="outline" size="xs">
            <ItemMedia>
              <PixelAvatar familiar={familiar} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-sm">
                <FamiliarLink id={familiar.id} />
                {room.lead === familiar.id && (
                  <span className="text-xs font-normal text-muted-foreground">
                    · lead
                  </span>
                )}
              </ItemTitle>
            </ItemContent>
            {!room.archived && (
              <ItemActions className="gap-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0 || change.isPending}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${familiar.name} up`}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === members.length - 1 || change.isPending}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${familiar.name} down`}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={members.length === 1 || change.isPending}
                  onClick={() =>
                    change.mutate(
                      room.familiars.filter((id) => id !== familiar.id),
                    )
                  }
                  aria-label={`Take ${familiar.name} out of the room`}
                >
                  <XIcon />
                </Button>
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
      {change.error && (
        <p className="text-xs text-destructive">{change.error.message}</p>
      )}
      {outside.length > 0 && !room.archived && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="self-start" />}
          >
            <PlusIcon />
            Add a Familiar
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {outside.map((familiar) => (
              <DropdownMenuItem
                key={familiar.id}
                onClick={() => change.mutate([...room.familiars, familiar.id])}
              >
                <PixelAvatar familiar={familiar} />
                {familiar.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
