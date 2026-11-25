import { useMutation } from '@tanstack/react-query'
import { HourglassSpinner } from '@/components/hourglass-spinner'
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
import { FieldError } from '@/components/ui/field'
import { queryClient } from '@/lib/familiar'
import { isUpdating, restartFamiliar } from '@/lib/updates'
import type { RestartDialogProps } from './types'

/**
 * Asks to restart Familiar's service, then shows it restarting until the
 * new daemon answers. Only the service can restart itself, so anywhere
 * else it says why it can't.
 */
export const RestartDialog = ({
  open,
  onOpenChange,
  info,
  description,
  trigger,
  cancelLabel = 'Cancel',
}: RestartDialogProps) => {
  const restart = useMutation({
    mutationFn: () => restartFamiliar(info.started),
    onSuccess: () => {
      onOpenChange(false)
      // What it read at startup, such as the models on offer, may differ.
      void queryClient.invalidateQueries()
    },
  })
  const reason = !info.installed
    ? "This Familiar runs from a source checkout, so it can't restart itself. Restart it where you started it."
    : !info.service
      ? "Familiar isn't running as a service, so it can't restart itself. Restart it where you started it."
      : isUpdating(info.last)
        ? "Familiar is updating, which restarts it when it's done."
        : undefined

  return (
    <AlertDialog
      open={open}
      // Stays open while restarting, so it can say when Familiar is back.
      onOpenChange={(next) => !restart.isPending && onOpenChange(next)}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        {restart.isPending ? (
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <HourglassSpinner />
              Restarting Familiar
            </AlertDialogTitle>
            <AlertDialogDescription>
              This page carries on once Familiar is back.
            </AlertDialogDescription>
          </AlertDialogHeader>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Restart Familiar?</AlertDialogTitle>
              <AlertDialogDescription>
                {reason ? `${description} ${reason}` : description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldError>{restart.error?.message}</FieldError>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {reason ? 'Close' : cancelLabel}
              </AlertDialogCancel>
              {!reason && (
                <AlertDialogAction onClick={() => restart.mutate()}>
                  Restart
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
