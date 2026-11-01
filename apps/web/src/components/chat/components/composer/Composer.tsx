import { useFamiliar } from '@familiar-ai/client/react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { ModelPicker } from '../model-picker'
import type { ComposerProps } from './types'

export const Composer = ({ busy }: ComposerProps) => {
  const send = useFamiliar((state) => state.conversation.send)
  const abort = useFamiliar((state) => state.conversation.abort)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const showStop = busy && !text.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message) {
      return
    }
    setText('')
    setError(undefined)
    try {
      // While busy this queues; Familiar answers it after the current reply.
      await send(message)
    } catch (cause) {
      setText(message)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form
      onSubmit={submit}
      className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="enter"
          aria-label="Message Familiar"
          placeholder="Message Familiar"
          rows={1}
          className="max-h-48 p-3 text-sm md:text-sm"
        />
        <InputGroupAddon align="block-end" className="gap-1">
          <ModelPicker />
          <InputGroupButton
            type={showStop ? 'button' : 'submit'}
            size="icon-sm"
            variant={showStop ? 'secondary' : 'default'}
            className="ml-auto"
            aria-label={showStop ? 'Stop' : 'Send'}
            disabled={!showStop && !text.trim()}
            onClick={showStop ? () => void abort() : undefined}
          >
            {showStop ? <SquareIcon /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </form>
  )
}
