import { formatTime } from '@/lib/format'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { Thinking } from '../thinking'
import { ScheduledPrompt } from './components/scheduled-prompt'
import type { TranscriptItemProps } from './types'

/** One item, with the time a turn was answered under its answer. */
export const TranscriptItem = ({ item, time }: TranscriptItemProps) => {
  if (item.type === 'scheduled') {
    return <ScheduledPrompt item={item} />
  }

  if (item.type === 'waiting') {
    return <Thinking text="" active />
  }

  if (item.type === 'message') {
    return <PersonMessage message={item} />
  }

  // Drawn by the rooms redesign.
  if (item.type === 'handoff' || item.type === 'note') {
    return null
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Reply reply={item} />
      {time !== undefined && (
        <p className="font-heading text-[0.7rem] text-muted-foreground">
          {formatTime(time)}
        </p>
      )}
    </div>
  )
}
