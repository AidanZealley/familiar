import { cn } from 'cn'
import { FamiliarTurn } from '@/components/chat/components/familiar-turn'
import { Reply } from '@/components/chat/components/reply'
import type { LiveRepliesProps } from './types'

/**
 * Variant B: each Familiar's reply as it streams, with its own thinking and
 * tool rows, side by side on a wide screen and stacked on a phone. Each
 * moves into the transcript, full width, when it lands.
 */
export const LiveReplies = ({ running }: LiveRepliesProps) =>
  running.length > 0 && (
    <div
      className={cn(
        'grid gap-5',
        running.length > 1 && 'sm:grid-cols-2 sm:gap-4',
      )}
    >
      {running.map(({ member, reply }) => (
        <div
          key={member.id}
          className={cn(
            'min-w-0',
            running.length > 1 && 'sm:border sm:border-border/60 sm:p-3',
          )}
        >
          <FamiliarTurn
            familiar={member.id}
            then={member.name}
            dm={false}
            run={{ live: true, last: reply.id }}
          >
            <Reply reply={reply} />
          </FamiliarTurn>
        </div>
      ))}
    </div>
  )
