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
import type { RemoveComputerProps } from './types'

/** Removes a Familiar's computer, once confirmed. */
export const RemoveComputer = ({
  familiar,
  provided,
  disabled,
  onRemove,
}: RemoveComputerProps) => (
  <AlertDialog>
    <AlertDialogTrigger
      render={<Button variant="destructive" disabled={disabled} />}
    >
      <TrashIcon />
      Remove computer
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove {familiar.name}'s computer?</AlertDialogTitle>
        <AlertDialogDescription>
          {provided
            ? `Everything on its disk is deleted: files, downloads and anything installed. ${familiar.name} can be given a new computer, but not this one back. This can't be undone.`
            : `${familiar.name} stops using this machine and the agent on it disconnects. Nothing on the machine is deleted, and you can pair it again later.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onRemove}>
          Remove
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
