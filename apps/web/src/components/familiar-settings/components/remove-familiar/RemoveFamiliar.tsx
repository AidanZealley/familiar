import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { TrashIcon } from '@phosphor-icons/react'
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
import { closeDialog } from '@/lib/dialogs'
import { workspace } from '@/lib/familiar'
import type { RemoveFamiliarProps } from './types'

/** Removes a Familiar for good, once confirmed, and goes home. */
export const RemoveFamiliar = ({ familiar }: RemoveFamiliarProps) => {
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => workspace.familiars.remove(familiar.id),
    // Its settings and DM close with it.
    onSuccess: () => {
      closeDialog()
      return navigate({ to: '/', replace: true })
    },
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="destructive" className="self-start" />}
      >
        <TrashIcon />
        Remove {familiar.name}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {familiar.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its memory and schedules are deleted, and it leaves every room.
            Rooms keep what it said. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.error && (
          <p className="text-sm text-destructive">{remove.error.message}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
