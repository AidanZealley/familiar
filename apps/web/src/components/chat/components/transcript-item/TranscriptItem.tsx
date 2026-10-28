import { ChevronRightIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { formatTime } from '@/lib/memory'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import { SavedFacts } from '../saved-facts'
import type { TranscriptItemProps } from './types'

/**
 * One item, with a margin beside it on wide screens: the time a message
 * was sent, and the facts a turn saved beside its answer, like notes in a
 * book's margin. On a phone an answer's margin folds under it, time first.
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
  const saved = margin?.saved ?? []
  const showsFooter = item.type === 'reply' && time !== undefined

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-2">
        {item.type === 'message' ? (
          <PersonMessage message={item} />
        ) : (
          <Reply reply={item} />
        )}
        {showsFooter &&
          (saved.length > 0 ? (
            <Collapsible className="lg:hidden">
              <CollapsibleTrigger className="group flex items-center gap-1 font-heading text-[0.7rem] text-muted-foreground">
                <ChevronRightIcon className="size-3 transition-transform group-data-panel-open:rotate-90" />
                {time} · {saved.length} saved
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <SavedFacts ids={saved} />
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="pl-4 font-heading text-[0.7rem] text-muted-foreground lg:hidden">
              {time}
            </p>
          ))}
      </div>
      <aside className="hidden pl-4 lg:block">
        {item.type === 'message' && time && (
          <p className="pt-1 font-heading text-[0.65rem] text-muted-foreground">
            {time}
          </p>
        )}
        {saved.length > 0 && <SavedFacts ids={saved} />}
      </aside>
    </div>
  )
}
