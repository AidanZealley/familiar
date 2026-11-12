import { useMutation } from '@tanstack/react-query'
import { BoxArrowUpIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/familiar'
import { RoomRow } from '@/components/room-row'
import type { ArchivedRoomRowProps } from './types'

/**
 * An archived room's row, with Unarchive beside it rather than inside its
 * link: shown on hover with a pointer, always on touch.
 */
export const ArchivedRoomRow = ({ room, familiars }: ArchivedRoomRowProps) => {
  const unarchive = useMutation({
    mutationFn: () => workspace.rooms.unarchive(room.id),
    onError: (error) =>
      toast.error(`Couldn't unarchive ${room.name}. ${error.message}`),
  })

  return (
    <div className="group/archived-row relative">
      <RoomRow room={room} familiars={familiars} className="pr-10" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Unarchive ${room.name}`}
        title="Unarchive"
        disabled={unarchive.isPending}
        onClick={() => unarchive.mutate()}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/archived-row:opacity-100 pointer-fine:focus-visible:opacity-100"
      >
        <BoxArrowUpIcon />
      </Button>
    </div>
  )
}
