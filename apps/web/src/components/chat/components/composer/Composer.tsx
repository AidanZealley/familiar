import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { familiar } from '@/lib/familiar'
import type { ComposerProps } from './types'

export const Composer = ({ busy }: ComposerProps) => {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const message = text.trim()
    if (!message) {
      return
    }
    setText('')
    setError(undefined)
    try {
      // While busy this queues; Familiar answers it after the current reply.
      await familiar.getState().send(message)
    } catch (cause) {
      setText(message)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <form
      onSubmit={submit}
      className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-end gap-2 rounded-xl border bg-card p-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Familiar"
          rows={1}
          className="max-h-48 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {busy && !text.trim() ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Stop"
            onClick={() => void familiar.getState().abort()}
          >
            <SquareIcon />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={!text.trim()}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </form>
  )
}
