import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { RemoveComputerDialogProps } from './types'

/**
 * Confirms removing a Familiar's computer, which deletes its disk: the
 * Computer page's button and the Tools page's switch both ask with it.
 */
export const RemoveComputerDialog = ({
  familiar,
  open,
  onOpenChange,
  onConfirm,
}: RemoveComputerDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove {familiar.name}'s computer?</AlertDialogTitle>
        <AlertDialogDescription>
          Everything on its disk is deleted: files, downloads and anything
          installed. {familiar.name} can be given a new computer, but not this
          one back. This can't be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          // A plain button, so it closes the dialog itself.
          onClick={() => {
            onOpenChange(false)
            onConfirm()
          }}
        >
          Remove
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
