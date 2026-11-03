import { SendIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t p-3">
      <div className="flex flex-wrap gap-1">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            variant="outline"
            size="xs"
            onClick={() => submit(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          submit(text)
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Message as ${name}`}
          aria-label={`Message Familiar as ${name}`}
        />
        <Button type="submit" size="icon" aria-label="Send">
          <SendIcon />
        </Button>
      </form>
    </div>
  )
}
