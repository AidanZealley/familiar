import { useMutation } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Trash2Icon } from 'lucide-react'
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
import { familiar } from '@/lib/familiar'
import type { RemoveServerProps } from './types'

const route = getRouteApi('/connections')

export const RemoveServer = ({ connection }: RemoveServerProps) => {
  const navigate = route.useNavigate()
  const { name, transport } = connection
  const remove = useMutation({
    mutationKey: ['connections'],
    mutationFn: () => familiar.mcp.remove(name),
    onSuccess: () => navigate({ search: ({ q }) => ({ q }) }),
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <Trash2Icon />
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
