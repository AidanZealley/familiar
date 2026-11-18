import RFB from '@novnc/novnc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useComputerControl } from '@/lib/computer-control'
import {
  computerDetailQuery,
  computerQuery,
  computerStates,
  screenUrl,
} from '@/lib/computers'
import { StatusDot } from '@/components/status-dot'
import { formatAgo } from '@/lib/format'
import { ScreenControls, type SendKey } from './components/screen-controls'
import type { ComputerScreenProps } from './types'

/** How long to wait before watching again after the screen closed. */
const RETRY_MS = 2000

/**
 * Each Familiar's last whole frame, as each viewer's connection ended, kept while the app is open so a sleeping computer still shows what
 * it last showed.
 */
const lastFrames = new Map<number, string>()

/**
 * Whether every pixel of `canvas` has been drawn. noVNC's canvas starts
 * transparent and the screen's pixels are opaque, so a frame shrunk to a
 * few pixels is fully opaque only if nothing in it was left undrawn.
 */
const fullyDrawn = (canvas: HTMLCanvasElement) => {
  if (!canvas.width || !canvas.height) {
    return false
  }
  const sample = document.createElement('canvas')
  sample.width = 16
  sample.height = 10
  const context = sample.getContext('2d', { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0, sample.width, sample.height)
  const { data } = context.getImageData(0, 0, sample.width, sample.height)
  return data.every((value, index) => index % 4 !== 3 || value === 255)
}

/** RFB's cursor pseudo-encodings: noVNC's own (-239) and VMware's. */
const CURSOR_ENCODINGS = new Set([-239, 0x574d5664])

/**
 * A socket to the screen on which noVNC's SetEncodings message leaves out
 * the cursor, so the display draws its own pointer into the picture: the
 * Familiar's, where it really is. Otherwise the display sends the pointer's
 * image apart, for noVNC to draw where the person's mouse is.
 */
const withoutCursor = (url: string) => {
  const socket = new WebSocket(url)
  const send = socket.send.bind(socket)
  socket.send = (data) => {
    // SetEncodings: type 2, padding, a count, then that many 32-bit
    // encodings. noVNC sends it alone; anything else goes as it is.
    if (data instanceof Uint8Array && data[0] === 2) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const count = view.getUint16(2)
      if (data.byteLength === 4 + 4 * count) {
        const kept = Array.from({ length: count }, (_, i) =>
          view.getInt32(4 + 4 * i),
        ).filter((encoding) => !CURSOR_ENCODINGS.has(encoding))
        const message = new DataView(new ArrayBuffer(4 + 4 * kept.length))
        message.setUint8(0, 2)
        message.setUint16(2, kept.length)
        kept.forEach((encoding, i) => message.setInt32(4 + 4 * i, encoding))
        return send(message.buffer)
      }
    }
    send(data)
  }
  return socket
}

/**
 * A Familiar's screen, live and fitted. While watching, nothing typed or
 * clicked here reaches it, and its pointer is drawn where the Familiar's
 * is. While this tab has control (`computer-control`), the screen takes
 * the mouse, keys and touches, ringed, and the pointer follows the
 * person's. Each one shown has its own connection, open while its last
 * status said it runs (or while it's held); watching never wakes it or
 * keeps it awake. A screen that closes while the computer still seems to
 * run is watched again shortly; while its status can't be read, it isn't.
 * Asleep, the last frame seen, dimmed. Full screen (`large`) has Take over
 * over its corner, which a click on the watched screen points to.
 */
export const ComputerScreen = ({
  familiar,
  size = 'small',
  input = true,
  className,
}: ComputerScreenProps) => {
  const queryClient = useQueryClient()
  const { data: status, isError: unreachable } = useQuery(
    computerQuery(familiar.id),
  )
  const { data: detail } = useQuery(computerDetailQuery(familiar.id))
  const held = useComputerControl(familiar.id) === 'held'
  /** Whether this view takes the person's input. */
  const controlling = held && input
  // A failed poll keeps the last answer, which may be stale. Held, it runs.
  const running = (status?.state === 'running' || held) && !unreachable
  const target = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB>(undefined)
  // Bumped by a click on a watched full screen, to point to Take over.
  const [attention, setAttention] = useState(0)
  const [live, setLive] = useState(false)
  // Bumped to watch again after the screen closed by itself.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!running) {
      return
    }
    // Controlling, noVNC's own cursor follows the mouse, to show input reaches it.
    const url = screenUrl(familiar.id)
    const rfb = new RFB(
      target.current!,
      controlling ? url : withoutCursor(url),
      {
        shared: true,
      },
    )
    rfb.viewOnly = !controlling
    rfb.scaleViewport = true
    rfb.focusOnClick = controlling
    rfbRef.current = rfb
    rfb.background = 'transparent'
    /** The screen as shown, which noVNC detaches as it disconnects. */
    let canvas: HTMLCanvasElement | null = null
    let left = false
    let retry: ReturnType<typeof setTimeout> | undefined
    /**
     * Keeps the frame shown, before anything renders without it: only a
     * whole one, so a connection that ended before its first full update
     * never replaces the last good frame.
     */
    const keepFrame = () => {
      if (canvas && fullyDrawn(canvas)) {
        lastFrames.set(familiar.id, canvas.toDataURL('image/jpeg', 0.85))
      }
    }
    rfb.addEventListener('connect', () => {
      canvas = target.current!.querySelector('canvas')
      setLive(true)
    })
    // The screen closed by itself; leaving is handled below.
    rfb.addEventListener('disconnect', () => {
      if (left) {
        return
      }
      keepFrame()
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
      keepFrame()
      rfb.disconnect()
      rfbRef.current = undefined
      setLive(false)
    }
  }, [familiar.id, running, controlling, attempt, queryClient])

  const sendKey: SendKey = (keysym, code, down) =>
    rfbRef.current?.sendKey(keysym, code, down)

  const asleep = status?.state === 'asleep'
  const frame = live ? undefined : lastFrames.get(familiar.id)
  const note = live
    ? undefined
    : unreachable
      ? ['Not connected', "Familiar isn't answering right now"]
      : asleep
        ? [
            'Asleep',
            [
              // Only from a look that saw it asleep too, or it's when it started.
              detail?.status?.state === 'asleep' &&
                detail.since &&
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
      onClick={
        size === 'large' && !controlling
          ? () => {
              toast('Take over to use it')
              setAttention((count) => count + 1)
            }
          : undefined
      }
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
      {/* noVNC's own: React never renders into it. Watching, touches and
          the pointer pass through, to scroll what's behind and keep the
          person's own cursor. */}
      <div
        ref={target}
        className={cn(
          'absolute inset-0',
          !controlling && 'pointer-events-none',
        )}
      />
      {controlling && (
        <div className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset" />
      )}
      {note && (
        <div
          className={cn(
            'absolute inset-0 grid place-items-center p-2 text-center text-white/90',
            size === 'large' ? 'text-sm' : 'text-[11px]',
          )}
        >
          <div>
            <div className="flex items-center justify-center gap-1 font-mono font-medium">
              {asleep && !unreachable && (
                <StatusDot tone={computerStates.asleep.tone} />
              )}
              {note[0]}
            </div>
            {note[1] && <div className="text-white/60">{note[1]}</div>}
          </div>
        </div>
      )}
      {size === 'large' && (
        <ScreenControls
          familiar={familiar}
          controlling={controlling}
          sendKey={sendKey}
          attention={attention}
        />
      )}
    </div>
  )
}
