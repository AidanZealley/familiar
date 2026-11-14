import { EraserIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useFamiliarStore } from '@/lib/familiar'
import { formatDate } from '@/lib/format'
import { SaidIn } from '../said-in'
import type { MemoryNoteProps } from './types'

/** One note and where it came from, with Forget. */
export const MemoryNote = ({ familiar, note, subject }: MemoryNoteProps) => {
  const store = useFamiliarStore()
  const forget = useMutation({
    mutationKey: ['memory', familiar.id],
    mutationFn: () => store.memory.forget(note.id),
  })

  return (
    <li className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span>{note.text}</span>
        <span className="text-xs text-muted-foreground">
          since {formatDate(note.since)} ·{' '}
          <SaidIn saidBy={note.saidBy} room={note.room} /> · “{note.quote}”
        </span>
        {forget.error && (
          <span className="text-xs text-destructive">
            {forget.error.message}
          </span>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button size="xs" variant="outline" disabled={forget.isPending} />
          }
        >
          <EraserIcon data-icon="inline-start" />
          Forget
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget this note?</AlertDialogTitle>
            <AlertDialogDescription>
              “{note.text}” goes from {subject.name}’s page, and the profile is
              cleared until it’s rewritten tonight. The conversation it came
              from stays. If it’s wrong, tell {familiar.name} instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogCancel
              variant="destructive"
              onClick={() => forget.mutate()}
            >
              Forget
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
