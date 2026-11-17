import { useMutation } from '@tanstack/react-query'
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
import { removeComputer } from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import type { RemoveComputerProps } from './types'

/** Removes a Familiar's computer, once confirmed. */
export const RemoveComputer = ({ familiar }: RemoveComputerProps) => {
  const remove = useMutation({
    mutationFn: () => removeComputer(familiar.id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['computer', familiar.id] }),
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <TrashIcon />
        Remove computer
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove {familiar.name}'s computer?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Everything on its disk is deleted: files, downloads and anything
            installed. {familiar.name} can be given a new computer, but not this
            one back. This can't be undone.
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
