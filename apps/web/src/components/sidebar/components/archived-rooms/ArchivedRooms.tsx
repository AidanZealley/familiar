import { ArchiveIcon, ChevronRightIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { RoomRow } from '../room-row'
import type { ArchivedRoomsProps } from './types'

/** Archived rooms, folded away: still readable, closed to new messages. */
export const ArchivedRooms = ({ rooms, familiars }: ArchivedRoomsProps) => (
  <Collapsible>
    <CollapsibleTrigger className="group/archived flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
      <ChevronRightIcon className="size-3 transition-transform group-data-[panel-open]/archived:rotate-90" />
      <ArchiveIcon className="size-3" />
      Archived
      <span className="tabular-nums">{rooms.length}</span>
    </CollapsibleTrigger>
    <CollapsibleContent className="flex flex-col">
      {rooms.map((room) => (
        <RoomRow key={room.id} room={room} familiars={familiars} />
      ))}
    </CollapsibleContent>
  </Collapsible>
)
