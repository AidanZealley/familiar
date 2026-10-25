import { Marker, MarkerContent } from '@/components/ui/marker'
import { PersonMessage } from '../person-message'
import { Reply } from '../reply'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({ item }: TranscriptItemProps) => {
  switch (item.type) {
    case 'message':
      return <PersonMessage message={item} />
    case 'reply':
      return <Reply reply={item} />
    case 'compaction':
      return (
        <Marker variant="separator" className="text-xs">
          <MarkerContent>Earlier messages summarised</MarkerContent>
        </Marker>
      )
  }
}
