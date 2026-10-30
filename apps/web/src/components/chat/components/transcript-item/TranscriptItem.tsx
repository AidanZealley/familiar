import { AlarmClockIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { formatTime } from '@/lib/memory'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { Thinking } from '../thinking'
import type { TranscriptItemProps } from './types'

/** One item, with the time a turn was answered under its answer. */
export const TranscriptItem = ({ item, time }: TranscriptItemProps) => {
  // Familiar's own earlier prompt, not the owner's words: a quiet line.
  if (item.type === 'scheduled') {
    return (
      <Marker className="justify-center text-xs">
        <MarkerIcon>
          <AlarmClockIcon />
        </MarkerIcon>
        <MarkerContent className="min-w-0 text-center">
          Scheduled · {item.prompt}
          {item.queued && ' (waiting)'}
        </MarkerContent>
      </Marker>
    )
  }

  if (item.type === 'compaction') {
    return (
      <Marker variant="separator" className="text-xs">
        <MarkerContent>Earlier messages summarised</MarkerContent>
      </Marker>
    )
  }

  if (item.type === 'waiting') {
    return <Thinking text="" active />
  }

  if (item.type === 'message') {
    return <PersonMessage message={item} />
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
