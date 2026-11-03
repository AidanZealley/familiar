import { LoaderIcon } from 'lucide-react'
import { ToolCallCard } from '../tool-call-card'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({ item }: TranscriptItemProps) => {
  switch (item.type) {
    case 'message':
      return (
        <div className="ml-8 self-end bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground">
          {item.text}
        </div>
      )
    case 'reply':
      return (
        <div className="flex flex-col gap-2">
          {item.toolCalls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
          {item.text && <p className="whitespace-pre-wrap">{item.text}</p>}
          {item.error && <p className="text-destructive">{item.error}</p>}
        </div>
      )
    case 'waiting':
      return (
        <LoaderIcon
          aria-label="Familiar is replying"
          className="size-4 animate-spin text-muted-foreground"
        />
      )
    default:
      return null
  }
}
