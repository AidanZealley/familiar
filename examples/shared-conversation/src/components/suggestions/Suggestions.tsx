import { Button } from '@/components/ui/button'
import { useFamiliar } from '@familiar-ai/client/react'
import type { SuggestionsProps } from './types'

/** Phrases the script understands, sent through this person's own client. */
export const Suggestions = ({ prompts }: SuggestionsProps) => {
  const send = useFamiliar((state) => state.conversation.send)
  return (
    <div className="flex flex-wrap gap-1">
      {prompts.map((prompt) => (
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
  )
}
