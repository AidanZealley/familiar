import { useRoom } from '@familiar-ai/client/react'
import { cn } from 'cn'
import { useCallback, useMemo, useState } from 'react'
import { PaneLoader } from '@/components/pane-loader'
import { Problem } from '@/components/problem'
import { Button } from '@/components/ui/button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useComputerView } from '@/lib/computer-view'
import { connectionProblems } from '@/lib/connection-problems'
import { useFamiliars } from '@/lib/workspace'
import { Composer } from './components/composer'
import { ComputerPane } from './components/computer-pane'
import { ComputerPopout } from './components/computer-popout'
import { ConversationHeader } from './components/conversation-header'
import { OlderMessages } from './components/older-messages'
import { SignIn } from './components/sign-in'
import { TranscriptItems } from './components/transcript-items'
import { useReadWhileOpen } from './read'
import type { ChatProps } from './types'

/**
 * The open room: its header, its transcript and the composer, marked read
 * while it's on screen. In a DM, the Familiar's screen can pop out over
 * it, or go full screen with the chat docked beside it (below, on a
 * phone), the same chat throughout so nothing in it is lost. Until the room's first view arrives, its header
 * over a loader; the view then stays through any reconnect, which the
 * header reports.
 */
export const Chat = ({ room }: ChatProps) => {
  const [scrollMargin, setScrollMargin] = useState(0)
  const measureScrollMargin = useCallback((content: HTMLDivElement | null) => {
    if (!content) {
      return
    }
    // The scroller positions anchors itself, so give it the same header
    // clearance as the content, including the device's safe area. Content
    // that isn't laid out yet, as while switching rooms, has no padding to
    // read; NaN would reach the scroller's IntersectionObserver and throw,
    // so the last measurement stands until the next resize.
    const measure = () => {
      const padding = Number.parseFloat(getComputedStyle(content).paddingTop)
      if (Number.isFinite(padding)) {
        setScrollMargin(padding)
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  useReadWhileOpen(room)
  const familiars = useFamiliars()
  const { view } = useComputerView()
  const dm =
    room.kind === 'dm'
      ? familiars.find((familiar) => familiar.id === room.familiar)
      : undefined
  const computer = dm && view
  const transcript = useRoom((state) => state.transcript)
  const startup = useRoom((state) =>
    state.view === undefined ? state.connection : 'ready',
  )
  const firstItemIds = useMemo(
    () => transcript?.items.slice(0, 3).map((item) => item.id) ?? [],
    [transcript],
  )

  if (startup !== 'ready') {
    return (
      <div className="flex h-full flex-col pt-(--chrome)">
        <ConversationHeader room={room} />
        {startup === 'connecting' ||
        startup === 'reconnecting' ||
        startup === 'open' ? (
          <PaneLoader />
        ) : (
          <Problem
            title="Couldn't open this conversation"
            description={connectionProblems[startup]}
            action={
              <Button onClick={() => window.location.reload()}>
                Reload Familiar
              </Button>
            }
          />
        )}
      </div>
    )
  }

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollMargin={scrollMargin}
    >
      {/* The scroller runs behind the glass header, where content padding
          keeps the first message clear of it, and ends in the composer,
          which sticks to its foot so the transcript scrolls behind it. */}
      <div
        className={cn(
          'flex h-full flex-col',
          // The shell hides the sidebar meanwhile, so this is the window.
          computer === 'full' && 'docked:flex-row',
        )}
      >
        {computer === 'full' && <ComputerPane familiar={dm!} />}
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col',
            // Docked, a column beside the screen. Stacked, its header and
            // transcript join the page's own column around the screen
            // (the header orders itself first), so the transcript sits
            // below the screen rather than under the header.
            computer === 'full' &&
              'docked:w-[min(24rem,40vw)] docked:flex-none docked:border-l docked:border-border stacked:contents stacked:[--header-overlap:0px]',
          )}
        >
          <ConversationHeader room={room} />
          <MessageScroller className="flex-1">
            {/* The shared scroller hides its thumb while it scrolls itself, which
              flashes on every streamed update, so keep one colour throughout. */}
            <MessageScrollerViewport className="flex scroll-pt-(--header-overlap,var(--chrome)) scrollbar-thumb-border flex-col mask-none! [-webkit-mask-image:none]! data-autoscrolling:scrollbar-thumb-border">
              {/* Pinned to the top as the transcript scrolls, and under the
                  composer, which a long draft grows into it. */}
              {computer === 'pop' && (
                <div className="sticky top-0 z-20 h-0">
                  <ComputerPopout familiar={dm!} />
                </div>
              )}
              <MessageScrollerContent
                ref={measureScrollMargin}
                aria-busy={transcript?.busy}
                className="mx-auto min-h-0 w-full max-w-(--page-width) shrink-0 grow gap-5 p-4 pt-[calc(var(--header-overlap,var(--chrome))+1rem)]"
              >
                <TranscriptItems
                  items={transcript?.items ?? []}
                  dm={room.kind === 'dm'}
                  lead={room.kind === 'room' ? room.lead : undefined}
                />
              </MessageScrollerContent>
              {/* Lined up with the conversation. */}
              <div className="sticky bottom-0 z-30 mx-auto w-full max-w-(--page-width)">
                <MessageScrollerButton className="data-[direction=end]:bottom-[calc(100%+1rem)]" />
                <SignIn />
                <Composer room={room} busy={transcript?.busy ?? false} />
              </div>
            </MessageScrollerViewport>
            <OlderMessages firstItemIds={firstItemIds} />
          </MessageScroller>
        </div>
      </div>
    </MessageScrollerProvider>
  )
}
