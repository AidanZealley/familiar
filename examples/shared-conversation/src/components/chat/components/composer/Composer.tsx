import { ArrowUpIcon } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { useFamiliar } from '@/demo/react'
import type { ComposerProps } from './types'

export const Composer = ({ prompts, name }: ComposerProps) => {
  // This person's own client: its session decides who the message is from.
  const send = useFamiliar((state) => state.conversation.send)
  const [text, setText] = useState('')
  const submit = (value: string) => {
    if (value.trim()) {
      void send(value.trim())
      setText('')
    }
  }
  // Enter sends and Shift+Enter starts a new line, as in Familiar's web UI.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form
      aria-label={`Message Familiar as ${name}`}
      className="flex shrink-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit(text)
      }}
    >
      <div className="flex flex-wrap gap-1">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => submit(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
      <InputGroup>
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`Message as ${name}`}
          aria-label={`Message as ${name}`}
          className="max-h-32"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-xs"
            aria-label="Send"
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
