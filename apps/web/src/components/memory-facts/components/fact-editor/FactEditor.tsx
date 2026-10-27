import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { familiar } from '@/lib/familiar'
import type { FactEditorProps } from './types'

export const FactEditor = ({ fact, onDone }: FactEditorProps) => {
  const [draft, setDraft] = useState(fact.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const save = async () => {
    const text = draft.trim()
    if (!text || text === fact.text) return onDone()
    setSaving(true)
    setError(undefined)
    try {
      await familiar.getState().reviseFact(fact.id, text)
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
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
            void save()
          }
          if (event.key === 'Escape') onDone()
        }}
        className="min-h-16"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Saving keeps the old wording as history.
        </p>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  )
}
