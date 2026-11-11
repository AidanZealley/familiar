import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { RoomAvatar } from '@/components/room-avatar'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { setupOf } from '@/lib/workspace'
import type { RoomRowProps } from './types'

/** A named room, with who's in it and who leads, opening it. */
export const RoomRow = ({ room, familiars }: RoomRowProps) => (
  <Item
    size="xs"
    className={cn(
      'gap-2.5 px-2 data-[status=active]:bg-muted',
      room.archived && 'opacity-70',
    )}
    render={<Link to="/room/$room" params={{ room: String(room.id) }} />}
  >
    <ItemMedia>
      <RoomAvatar
        members={familiars.filter((familiar) =>
          room.familiars.includes(familiar.id),
        )}
      />
    </ItemMedia>
    <ItemContent className="min-w-0 gap-0">
      <ItemTitle className="w-full truncate text-sm">{room.name}</ItemTitle>
      <ItemDescription className="line-clamp-1">
        {setupOf(room, familiars)}
      </ItemDescription>
    </ItemContent>
  </Item>
)
