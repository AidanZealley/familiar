import RFB from '@novnc/novnc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import {
  computerDetailQuery,
  computerQuery,
  computerStates,
  screenUrl,
} from '@/lib/computers'
import { formatAgo } from '@/lib/format'
import type { ComputerScreenProps } from './types'

/** How long to wait before watching again after the screen closed. */
const RETRY_MS = 2000

/**
 * Each Familiar's last frame, as each viewer's connection ended, kept while
 * the app is open so a sleeping computer still shows what it last showed.
 */
const lastFrames = new Map<number, string>()

/**
 * A Familiar's screen, live and fitted, for watching only: nothing typed or
 * clicked here reaches it. Each one shown has its own connection, open
 * while its computer runs; watching never wakes it or keeps it awake. A
 * screen that closes while the computer still seems to run is watched
 * again shortly. Asleep, the last frame seen, dimmed.
 */
export const ComputerScreen = ({
  familiar,
  size = 'small',
  className,
}: ComputerScreenProps) => {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(computerQuery(familiar.id))
  const { data: detail } = useQuery(computerDetailQuery(familiar.id))
  const running = status?.state === 'running'
  const target = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  // Bumped to watch again after the screen closed by itself.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!running) {
      return
    }
    const rfb = new RFB(target.current!, screenUrl(familiar.id), {
      shared: true,
    })
    rfb.viewOnly = true
    rfb.scaleViewport = true
    rfb.focusOnClick = false
    rfb.background = 'transparent'
    let connected = false
    let left = false
    let retry: ReturnType<typeof setTimeout> | undefined
    rfb.addEventListener('connect', () => {
      connected = true
      setLive(true)
    })
    rfb.addEventListener('disconnect', () => {
      if (connected) {
        lastFrames.set(familiar.id, rfb.toDataURL('image/jpeg', 0.85))
      }
      if (left) {
        return
      }
      setLive(false)
      // It may have gone to sleep: ask now, and watch again if not.
      void queryClient.invalidateQueries({
        queryKey: computerQuery(familiar.id).queryKey,
        exact: true,
      })
      retry = setTimeout(() => setAttempt((count) => count + 1), RETRY_MS)
    })
    return () => {
      left = true
      clearTimeout(retry)
      rfb.disconnect()
      setLive(false)
    }
  }, [familiar.id, running, attempt, queryClient])

  const asleep = status?.state === 'asleep'
  const frame = live ? undefined : lastFrames.get(familiar.id)
  const note = live
    ? undefined
    : asleep
      ? [
          'Asleep',
          [
            detail?.since &&
              `Went to sleep ${formatAgo(Date.parse(detail.since))}`,
            size === 'large' && `it wakes when ${familiar.name} needs it`,
          ]
            .filter(Boolean)
            .join(' · '),
        ]
      : running
        ? ['Connecting…']
        : status && [computerStates[status.state].label]

  return (
    <div
      role="img"
      aria-label={`${familiar.name}'s screen${note ? `: ${note[0]}` : ''}`}
      className={cn(
        'relative aspect-[16/10] overflow-hidden bg-black',
        className,
      )}
    >
      {frame && (
        <img
          src={frame}
          alt=""
          className={cn(
            'absolute inset-0 size-full object-contain',
            asleep && 'opacity-40',
          )}
        />
      )}
      {/* noVNC's own: React never renders into it. */}
      <div ref={target} className="absolute inset-0" />
      {note && (
        <div
          className={cn(
            'absolute inset-0 grid place-items-center p-2 text-center text-white/90',
            size === 'large' ? 'text-sm' : 'text-[11px]',
          )}
        >
          <div>
            <div className="font-mono font-medium">{note[0]}</div>
            {note[1] && <div className="text-white/60">{note[1]}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
