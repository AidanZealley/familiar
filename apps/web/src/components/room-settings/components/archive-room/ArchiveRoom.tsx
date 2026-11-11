import { useMutation } from '@tanstack/react-query'
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { workspace } from '@/lib/familiar'
import type { ArchiveRoomProps } from './types'

/** Archives the room, once confirmed, or unarchives an archived one. */
export const ArchiveRoom = ({ room }: ArchiveRoomProps) => {
  const archive = useMutation({
    mutationFn: () =>
      room.archived
        ? workspace.rooms.unarchive(room.id)
        : workspace.rooms.archive(room.id),
  })
  const error = archive.error && (
    <p className="text-sm text-destructive">{archive.error.message}</p>
  )

  if (room.archived) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          variant="outline"
          className="self-start"
          disabled={archive.isPending}
          onClick={() => archive.mutate()}
        >
          <ArchiveRestoreIcon />
          Unarchive {room.name}
        </Button>
        {error}
      </div>
    )
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="destructive" className="self-start" />}
      >
        <ArchiveIcon />
        Archive {room.name}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {room.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its Familiars stop answering here until you unarchive it. Its
            history is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
