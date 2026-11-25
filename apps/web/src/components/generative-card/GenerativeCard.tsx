import { useCallback, useEffect, useRef } from 'react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { Args, OnAction, OnRead } from 'gencn'
import { useGencnView } from 'gencn/react'
import type { JsonObject } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { blocks } from '@/cards/blocks'
import { ToolApproval } from '@/components/chat/components/tool-approval'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import type { GenerativeCardProps } from './types'
import { cardStatus } from './wording'

/** A card's args come from its JSON spec and state, so they're JSON. */
const json = (args: Args) => args as JsonObject

/**
 * A card a Familiar showed. Its controls run the Familiar's tools for the
 * person through the room (`tools.run`); a card with a refresh reads again
 * (`tools.read`) each time it comes on screen and on Refresh. A tool that's
 * gone, a failed read or a card this app can't draw shows as no longer
 * available.
 */
export const GenerativeCard = ({ spec, familiar }: GenerativeCardProps) => {
  const room = useRoomStore()
  const onAction = useCallback<OnAction>(
    (tool, args, { approved }) =>
      room.tools.run(familiar, { tool, args: json(args), approved }),
    [room, familiar],
  )
  const onRead = useCallback<OnRead>(
    async (tool, args) => {
      const read = await room.tools.read(familiar, { tool, args: json(args) })
      if (read.outcome === 'read') {
        return read.text
      }
      throw new Error(read.outcome === 'failed' ? read.message : read.outcome)
    },
    [room, familiar],
  )
  const { content, phase, refresh } = useGencnView(spec, {
    blocks,
    onAction,
    onRead,
  })

  // Reads only while the card is on screen, so history doesn't query the
  // house for every old card.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!refresh || !element) {
      return
    }
    let visible = false
    const observer = new IntersectionObserver(([entry]) => {
      const now = !!entry?.isIntersecting
      if (now && !visible) {
        void refresh()
      }
      visible = now
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [refresh])

  const status = cardStatus(phase)
  const busy = phase.kind === 'running' || phase.kind === 'reading'
  return (
    <div ref={ref} className="flex max-w-md flex-col gap-2">
      <div className="relative">
        <div className={cn(phase.kind === 'unavailable' && 'opacity-40')}>
          {content ?? <div className="h-24 border border-dashed" />}
        </div>
        {phase.kind === 'unavailable' && (
          <div className="absolute inset-0 grid place-content-center gap-2 text-sm text-muted-foreground">
            <p>No longer available</p>
            {phase.reason === 'read-failed' && refresh && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void refresh()}
              >
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
      {(status || refresh) && phase.kind !== 'unavailable' && (
        <div className="flex min-h-6 items-center justify-between gap-2 text-xs">
          <p
            role={phase.kind === 'idle' ? 'alert' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2',
              phase.kind === 'idle'
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {busy && <HourglassSpinner />}
            <span className="line-clamp-2">{status}</span>
          </p>
          {refresh && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh"
              disabled={phase.kind !== 'idle'}
              onClick={() => void refresh()}
            >
              <ArrowClockwiseIcon />
            </Button>
          )}
        </div>
      )}
      {phase.kind === 'asking' && (
        <ToolApproval
          tool={phase.tool}
          args={phase.args}
          onApprove={() => phase.answer(true)}
          onDecline={() => phase.answer(false)}
        />
      )}
      {phase.kind === 'confirming' && (
        <ToolApproval
          tool={phase.tool}
          args={phase.args}
          confirm={phase.confirm}
          onApprove={() => phase.answer(true)}
          onDecline={() => phase.answer(false)}
        />
      )}
    </div>
  )
}
