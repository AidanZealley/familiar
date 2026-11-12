import { useMutation } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  CrownIcon,
  ArrowUpIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { FamiliarLink } from '@/components/familiar-link'
import { LeadBadge } from '@/components/lead-badge'
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

/**
 * The room's Familiars, in order, to crown as lead, move or take out; then
 * every other Familiar, faint, each a click from joining. A crowned lead
 * moves to the top; crowning it again opens the room and leaves it there.
 */
/** Its members in order, and which of them leads, if any. */
type Setup = { order: readonly number[]; lead: number | undefined }

export const MembersSettings = ({ room }: MembersSettingsProps) => {
  const familiars = useFamiliars()
  const change = useMutation({
    mutationFn: (next: Setup) =>
      workspace.rooms.update(room.id, {
        familiars: [...next.order],
        lead: next.lead ?? null,
      }),
  })
  // Shown as asked straight away, rather than dimming every control until
  // the room confirms it.
  const shown: Setup = (change.isPending && change.variables) || {
    order: room.familiars,
    lead: room.lead,
  }
  const save = (order: readonly number[], lead = shown.lead) =>
    // A lead taken out leaves the room open.
    change.mutate({
      order,
      lead: lead !== undefined && order.includes(lead) ? lead : undefined,
    })
  const outside = familiars.filter(
    (familiar) => !shown.order.includes(familiar.id),
  )
  const members = shown.order.flatMap(
    (id) => familiars.find((familiar) => familiar.id === id) ?? [],
  )
  const move = (index: number, by: number) => {
    const next = [...shown.order]
    const [moved] = next.splice(index, 1)
    next.splice(index + by, 0, moved!)
    save(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-1.5">
        {members.map((familiar, index) => (
          <Item key={familiar.id} variant="outline" size="xs">
            <ItemMedia className="relative">
              <PixelAvatar familiar={familiar} />
              {shown.lead === familiar.id && <LeadBadge />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-sm">
                <FamiliarLink id={familiar.id} />
              </ItemTitle>
            </ItemContent>
            {!room.archived && (
              <ItemActions className="gap-0">
                <Button
                  variant={shown.lead === familiar.id ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-pressed={shown.lead === familiar.id}
                  onClick={() =>
                    shown.lead === familiar.id
                      ? // Uncrowned, it keeps its place.
                        save(shown.order, undefined)
                      : // Crowned, it moves to the top.
                        save(
                          [
                            familiar.id,
                            ...shown.order.filter((id) => id !== familiar.id),
                          ],
                          familiar.id,
                        )
                  }
                  aria-label={
                    shown.lead === familiar.id
                      ? `${familiar.name} leads: open the room instead`
                      : `Make ${familiar.name} the lead`
                  }
                  title={
                    shown.lead === familiar.id
                      ? 'Leads: click to open the room'
                      : 'Make lead'
                  }
                >
                  <CrownIcon
                    weight={shown.lead === familiar.id ? 'fill' : 'regular'}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${familiar.name} up`}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === members.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${familiar.name} down`}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={members.length === 1}
                  onClick={() =>
                    save(shown.order.filter((id) => id !== familiar.id))
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
                    onClick={() => save([...shown.order, familiar.id])}
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
