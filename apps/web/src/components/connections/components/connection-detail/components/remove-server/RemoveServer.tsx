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
import { workspace } from '@/lib/familiar'
import type { RemoveServerProps } from './types'

export const RemoveServer = ({ connection }: RemoveServerProps) => {
  const { name, transport } = connection
  const remove = useMutation({
    mutationKey: ['connections'],
    // Once it's gone from the list, Connections shows the list again.
    mutationFn: () => workspace.mcp.remove(name),
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <TrashIcon />
        Remove
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Familiar stops using its tools now
            {transport.type === 'stdio'
              ? ' and its process stops'
              : transport.auth.type === 'bearer' &&
                ', and its token is deleted'}
            . To use it again, add it again.
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
