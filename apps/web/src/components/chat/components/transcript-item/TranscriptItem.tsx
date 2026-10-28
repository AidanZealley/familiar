import { Marker, MarkerContent } from '@/components/ui/marker'
import { formatTime } from '@/lib/memory'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import type { TranscriptItemProps } from './types'

/**
 * One item, with a margin beside it on wide screens: the time a message
 * was sent. On a phone an answer's time sits under it.
 */
export const TranscriptItem = ({ item, margin }: TranscriptItemProps) => {
  if (item.type === 'compaction') {
    return (
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
        <Marker variant="separator" className="text-xs">
          <MarkerContent>Earlier messages summarised</MarkerContent>
        </Marker>
      </div>
    )
  }

  const time = margin?.at === undefined ? undefined : formatTime(margin.at)
  const showsFooter = item.type === 'reply' && time !== undefined

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-2">
        {item.type === 'message' ? (
          <PersonMessage message={item} />
        ) : (
          <Reply reply={item} />
        )}
        {showsFooter && (
          <p className="pl-4 font-heading text-[0.7rem] text-muted-foreground lg:hidden">
            {time}
          </p>
        )}
      </div>
      <aside className="hidden pl-4 lg:block">
        {item.type === 'message' && time && (
          <p className="pt-1 font-heading text-[0.65rem] text-muted-foreground">
            {time}
          </p>
        )}
      </aside>
    </div>
  )
}
