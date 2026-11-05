import { SendIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFamiliarStore } from '@familiar-ai/client/react'
import { SUGGESTED_PROMPTS } from '@/assistant/script'

export const Composer = () => {
  const {
    conversation: { send },
  } = useFamiliarStore()
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
        {SUGGESTED_PROMPTS.map((prompt) => (
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
          placeholder="Ask Familiar"
          aria-label="Message Familiar"
        />
        <Button type="submit" size="icon" aria-label="Send">
          <SendIcon />
        </Button>
      </form>
    </div>
  )
}
