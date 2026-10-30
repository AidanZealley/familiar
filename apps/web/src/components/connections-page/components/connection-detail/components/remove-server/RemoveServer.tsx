import { getRouteApi, useRouter } from '@tanstack/react-router'
import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'
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
  const router = useRouter()
  const navigate = route.useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { name, transport } = connection

  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await familiar.getState().removeMcpServer(name)
      await navigate({ search: ({ q }) => ({ q }) })
      await router.invalidate()
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
