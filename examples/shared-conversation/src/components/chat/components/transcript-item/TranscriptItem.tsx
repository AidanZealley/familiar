import { LoaderIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ToolCallCard } from '../tool-call-card'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({
  item,
  viewer,
  continued,
}: TranscriptItemProps) => {
  switch (item.type) {
    case 'message': {
      // The author as the host signed them in when they sent this.
      const author =
        typeof item.author === 'string' ? { name: item.author } : item.author
      const mine = 'id' in author && author.id === viewer.id
      return (
        <div
          className={cn(
            'flex max-w-[85%] flex-col gap-1',
            mine ? 'items-end self-end' : 'items-start',
          )}
        >
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="font-medium text-foreground">{author.name}</span>
            {mine && <span>(you)</span>}
            {item.queued && <Badge variant="outline">Queued</Badge>}
          </div>
          <p
            className={cn(
              'px-3 py-2 whitespace-pre-wrap',
              mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
            )}
          >
            {item.text}
          </p>
        </div>
      )
    }
    case 'reply':
      return (
        <div className="flex flex-col gap-2">
          {!continued && <span className="font-medium">Familiar</span>}
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
