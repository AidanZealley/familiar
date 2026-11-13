import { useMutation } from '@tanstack/react-query'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useFamiliarStore } from '@/lib/familiar'
import { formatDate } from '@/lib/format'
import type { MemoryNoteProps } from './types'

const STANDING = {
  stated: 'asked to remember',
  confirmed: 'repeated',
  tentative: 'said once',
}

/** One note: what it says, how well supported, who said it, its quote, and Forget. */
export const MemoryNote = ({ familiar, note, subject }: MemoryNoteProps) => {
  const store = useFamiliarStore()
  const forget = useMutation({
    mutationKey: ['memory', familiar],
    mutationFn: () => store.memory.forget(note.id),
  })
  if (note.retired?.reason === 'forgotten') {
    return (
      <li className="text-xs text-muted-foreground">
        Forgotten on {new Date(note.retired.at).toLocaleDateString()}.
      </li>
    )
  }
  const firstHand =
    subject.participant?.kind === 'person' &&
    subject.participant.id === note.saidBy.id

  return (
    <li className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className={cn(note.retired && 'text-muted-foreground line-through')}>
          {note.text}
        </p>
        <p className="text-xs text-muted-foreground">
          {note.kind} · {STANDING[note.standing]} ·{' '}
          {firstHand ? 'first-hand' : `said by ${note.saidBy.name}`} ·{' '}
          {note.until
            ? `${formatDate(note.since)} to ${formatDate(note.until)}`
            : `since ${formatDate(note.since)}`}
          {note.retired && ` · ${note.retired.reason}`}
        </p>
        <p className="text-xs text-muted-foreground italic">“{note.quote}”</p>
        {forget.error && (
          <p className="text-xs text-destructive">{forget.error.message}</p>
        )}
      </div>
      {!note.retired && (
        <Button
          size="sm"
          variant="ghost"
          disabled={forget.isPending}
          onClick={() => forget.mutate()}
        >
          Forget
        </Button>
      )}
    </li>
  )
}
