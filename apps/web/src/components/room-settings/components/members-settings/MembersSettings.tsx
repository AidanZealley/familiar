import { useMutation } from '@tanstack/react-query'
import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { FamiliarLink } from '@/components/familiar-link'
import { PixelAvatar } from '@/components/pixel-avatar'
import { Button } from '@/components/ui/button'
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

export const MembersSettings = ({ room }: MembersSettingsProps) => {
  const familiars = useFamiliars()
  const change = useMutation({
    mutationFn: (familiars: number[]) =>
      workspace.rooms.update(room.id, { familiars }),
  })
  // Shown as asked straight away, rather than dimming every control until
  // the room confirms it.
  const shown = (change.isPending && change.variables) || room.familiars
  const save = change.mutate
  const outside = familiars.filter((familiar) => !shown.includes(familiar.id))
  const members = shown.flatMap(
    (id) => familiars.find((familiar) => familiar.id === id) ?? [],
  )
  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-1.5">
        {members.map((familiar) => (
          <Item key={familiar.id} variant="outline" size="xs">
            <ItemMedia className="relative">
              <PixelAvatar familiar={familiar} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-sm">
                <FamiliarLink id={familiar.id} />
              </ItemTitle>
            </ItemContent>
            {!room.archived && (
              <ItemActions className="gap-0">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={members.length === 1}
                  onClick={() => save(shown.filter((id) => id !== familiar.id))}
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
        <div className="flex flex-col gap-1.5 pt-2">
          <p className="text-xs text-muted-foreground">Not in this room</p>
          <ItemGroup className="gap-1.5">
            {outside.map((familiar) => (
              <Item
                key={familiar.id}
                variant="outline"
                size="xs"
                className="border-dashed"
              >
                <ItemMedia className="opacity-70">
                  <PixelAvatar familiar={familiar} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-sm text-muted-foreground">
                    {familiar.name}
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => save([...shown, familiar.id])}
                    aria-label={`Add ${familiar.name} to the room`}
                  >
                    <PlusIcon />
                    Add
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </div>
      )}
    </div>
  )
}
