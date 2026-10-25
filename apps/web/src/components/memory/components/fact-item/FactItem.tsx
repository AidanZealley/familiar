import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { familiar } from '@/lib/familiar'
import type { FactItemProps } from './types'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export const FactItem = ({ fact }: FactItemProps) => {
  // The text being edited, or undefined when not editing.
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()

  const run = async (action: () => Promise<void>) => {
    setError(undefined)
    try {
      await action()
      setDraft(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const save = () => {
    const text = draft?.trim()
    if (!text || text === fact.text) return setDraft(undefined)
    void run(() => familiar.getState().reviseFact(fact.id, text))
  }

  return (
    <li className="rounded-lg border p-3">
      {draft === undefined ? (
        <div className="flex items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap">{fact.text}</p>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit"
            onClick={() => setDraft(fact.text)}
          >
            <PencilIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Forget"
            onClick={() =>
              void run(() => familiar.getState().forgetFact(fact.id))
            }
          >
            <Trash2Icon />
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                save()
              }
              if (event.key === 'Escape') setDraft(undefined)
            }}
            className="min-h-9 flex-1"
          />
          <Button size="icon-sm" aria-label="Save" onClick={save}>
            <CheckIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel"
            onClick={() => setDraft(undefined)}
          >
            <XIcon />
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {fact.id} · {dateFormat.format(fact.at)}
      </p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  )
}
