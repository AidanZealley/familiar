import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useFamiliarStore } from '@/lib/familiar'
import { formatDate } from '@/lib/format'
import type { MemoryNoteProps } from './types'

/** One note: what it says, who said it, its quote, and Forget. */
export const MemoryNote = ({ familiar, note, subject }: MemoryNoteProps) => {
  const store = useFamiliarStore()
  const forget = useMutation({
    mutationKey: ['memory', familiar],
    mutationFn: () => store.memory.forget(note.id),
  })
  const firstHand = subject.person === note.saidBy.id

  return (
    <li className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p>{note.text}</p>
        <p className="text-xs text-muted-foreground">
          {firstHand ? 'first-hand' : `said by ${note.saidBy.name}`} · since{' '}
          {formatDate(note.since)}
        </p>
        <p className="text-xs text-muted-foreground italic">“{note.quote}”</p>
        {forget.error && (
          <p className="text-xs text-destructive">{forget.error.message}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={forget.isPending}
        onClick={() => forget.mutate()}
      >
        Forget
      </Button>
    </li>
  )
}
