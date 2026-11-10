import { ArrowUpIcon } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { useRoomStore } from '@familiar-ai/client/react'
import { SUGGESTED_PROMPTS } from '@/familiar/script'

/** As in Familiar's web UI: a textarea with its send button below, at the end. */
export const Composer = () => {
  const { send } = useRoomStore()
  const [text, setText] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim()) {
      void send(text.trim())
      setText('')
    }
  }
  // Enter sends and Shift+Enter starts a new line.
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
    <div className="flex shrink-0 flex-col gap-3 border-t p-3">
      <div className="flex flex-wrap gap-1">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            variant="outline"
            size="xs"
            onClick={() => void send(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
      <form aria-label="Message Familiar" onSubmit={submit}>
        {/* InputGroup dims itself while any control in it is disabled, which
            an empty message's Send button is. As in Familiar's web UI, keep the
            box at full contrast and let only the button show it. */}
        <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
          <InputGroupTextarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask Familiar"
            aria-label="Message Familiar"
            className="max-h-32 p-3"
          />
          <InputGroupAddon align="block-end" className="gap-1">
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="ml-auto"
              aria-label="Send"
              disabled={!text.trim()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
