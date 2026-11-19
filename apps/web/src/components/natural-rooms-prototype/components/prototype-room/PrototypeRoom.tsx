import { Fragment, useEffect, useMemo, useRef } from 'react'
import { TranscriptItem } from '@/components/chat/components/transcript-item'
import { replyRuns } from '@/components/chat/components/transcript-items/layout'
import type { Turn } from '../../timeline'
import { LiveReplies } from '../live-replies'
import { PrototypeHeader } from '../prototype-header'
import { QueuedMark } from '../queued-mark'
import { TypingRow } from '../typing-row'
import type { PrototypeRoomProps } from './types'

type Running = Extract<Turn, { status: 'running' }>

/**
 * One room at one step of the fixture timeline, drawn with the chat's own
 * transcript items, in one replying variant and one queued variant.
 */
export const PrototypeRoom = ({
  frame,
  members,
  replying,
  queued,
  caption,
}: PrototypeRoomProps) => {
  const runs = useMemo(() => replyRuns(frame.log), [frame.log])
  const running = frame.turns.filter(
    (turn): turn is Running => turn.status === 'running',
  )
  const waiting = frame.turns.filter((turn) => turn.status !== 'running')
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the newest at the foot, as the chat's scroller does.
  useEffect(() => {
    const node = scroller.current
    node?.scrollTo({ top: node.scrollHeight })
  }, [frame])

  // A's row holds who's replying; queued A adds the queued, dimmed. With
  // B or C, the row appears only for queued A's dimmed portraits.
  const rowRunning = replying === 'A' ? running : []
  const rowWaiting = queued === 'A' ? waiting : []

  return (
    <section className="flex min-w-0 flex-col gap-2">
      {caption && (
        <h3 className="font-heading text-xs font-medium text-muted-foreground">
          {caption}
        </h3>
      )}
      <div className="flex h-[38rem] min-w-0 flex-col overflow-hidden border border-border bg-background">
        <PrototypeHeader
          title="Garden plans"
          members={members}
          turns={frame.turns}
          faces={replying === 'C'}
        />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-4">
            {frame.log.map((item) => (
              <Fragment key={item.id}>
                <TranscriptItem
                  item={item}
                  dm={false}
                  lead={members[0]?.id}
                  run={runs.get(item.id)}
                />
                {queued === 'B' && item.id === frame.asked && (
                  <QueuedMark waiting={waiting} />
                )}
              </Fragment>
            ))}
            {replying === 'B' && <LiveReplies running={running} />}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 p-3 pt-0">
          {(rowRunning.length > 0 || rowWaiting.length > 0) && (
            <div className="px-1 pt-2">
              <TypingRow running={rowRunning} waiting={rowWaiting} />
            </div>
          )}
          <div className="border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            Message Garden plans
          </div>
        </div>
      </div>
    </section>
  )
}
