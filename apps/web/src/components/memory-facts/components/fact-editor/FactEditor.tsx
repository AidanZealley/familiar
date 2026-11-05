import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { familiar } from '@/lib/familiar'
import type { FactEditorProps } from './types'

/** Rewrites a fact. A failure shows under it, with the fact's others. */
export const FactEditor = ({ fact, onDone }: FactEditorProps) => {
  const [draft, setDraft] = useState(fact.text)
  const revise = useMutation({
    mutationKey: ['fact', fact.id],
    mutationFn: (text: string) => familiar.memory.revise(fact.id, text),
    onSuccess: onDone,
  })

  const save = () => {
    const text = draft.trim()
    if (!text || text === fact.text) {
      onDone()
    } else {
      revise.mutate(text)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            save()
          }
          if (event.key === 'Escape') {
            onDone()
          }
        }}
        className="min-h-16"
      />
      <div className="flex items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Saving keeps the old wording as history.
        </p>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={revise.isPending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}
