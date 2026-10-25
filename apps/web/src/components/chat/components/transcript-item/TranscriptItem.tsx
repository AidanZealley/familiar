import { cn } from '@/lib/utils'
import { ToolCall } from '../tool-call'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({ item }: TranscriptItemProps) => {
  switch (item.type) {
    case 'message':
      return (
        <div
          className={cn(
            'max-w-[85%] self-end rounded-2xl bg-primary px-3.5 py-2 whitespace-pre-wrap text-primary-foreground',
            item.queued && 'opacity-60',
          )}
        >
          {item.text}
        </div>
      )
    case 'reply':
      return (
        <div className="flex flex-col gap-2">
          {item.toolCalls.map((call) => (
            <ToolCall key={call.id} call={call} />
          ))}
          {item.text && <div className="whitespace-pre-wrap">{item.text}</div>}
          {item.streaming && !item.text && item.toolCalls.length === 0 && (
            <div className="animate-pulse text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
          {item.error && (
            <div className="text-sm text-destructive">{item.error}</div>
          )}
        </div>
      )
    case 'compaction':
      return (
        <div className="text-center text-xs text-muted-foreground">
          Earlier messages summarised
        </div>
      )
  }
}
