import { ArchiveIcon, CaretRightIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ArchivedRoomRow } from './components/archived-room-row'
import type { ArchivedRoomsProps } from './types'

/** Archived rooms, folded away: still readable, closed to new messages, and each one unarchivable. */
export const ArchivedRooms = ({ rooms, familiars }: ArchivedRoomsProps) => (
  <Collapsible>
    <CollapsibleTrigger className="group/archived flex w-full items-center gap-1.5 py-1.5 pr-3 pl-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
      <ArchiveIcon className="size-3" />
      Archived
      <span className="tabular-nums">{rooms.length}</span>
      <CaretRightIcon className="ml-auto size-3 transition-transform group-data-[panel-open]/archived:rotate-90" />
    </CollapsibleTrigger>
    <CollapsibleContent className="flex flex-col">
      {rooms.map((room) => (
        <ArchivedRoomRow key={room.id} room={room} familiars={familiars} />
      ))}
    </CollapsibleContent>
  </Collapsible>
)
