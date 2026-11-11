import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { RoomAvatar } from '@/components/room-avatar'
import { Item, ItemMedia } from '@/components/ui/item'
import { liveOf, setupOf } from '@/lib/workspace'
import { RowSummary } from '../row-summary'
import type { RoomRowProps } from './types'

/**
 * A named room, opening it: its faces, talking while they reply, and its
 * latest entry, or who's in it and who leads until there is one.
 */
export const RoomRow = ({ room, familiars, className }: RoomRowProps) => (
  <Item
    size="xs"
    className={cn(
      'gap-2.5 px-2 data-[status=active]:bg-muted',
      room.archived && 'opacity-70',
      className,
    )}
    render={<Link to="/room/$room" params={{ room: String(room.id) }} />}
  >
    <ItemMedia>
      <RoomAvatar
        members={familiars.filter((familiar) =>
          room.familiars.includes(familiar.id),
        )}
        talking={liveOf(room.turns).running}
      />
    </ItemMedia>
    <RowSummary
      title={room.name}
      room={room}
      fallback={setupOf(room, familiars)}
    />
  </Item>
)
