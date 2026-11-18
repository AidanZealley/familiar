import { ArrowsOutIcon, XIcon } from '@phosphor-icons/react'
import { ComputerActivity } from '@/components/computer-activity'
import { ComputerScreen } from '@/components/computer-screen'
import { Button } from '@/components/ui/button'
import { useComputerView } from '@/lib/computer-view'
import type { ComputerPopoutProps } from './types'

/**
 * The Familiar's screen in a small window over the chat, which stays while
 * the person chats, under a bar with what it's doing, full screen and close.
 * It's for watching: the whole preview opens full screen, where the person
 * can take over.
 */
export const ComputerPopout = ({ familiar }: ComputerPopoutProps) => {
  const { show } = useComputerView()

  return (
    <div className="absolute top-[calc(var(--chrome)+0.5rem)] right-2 w-48 bg-popover shadow-2xl ring-1 ring-foreground/15 md:right-4 md:w-80">
      {/* Controls on top: in a short window, a long draft may cover the
          bottom of the screen, never these. */}
      <div className="flex h-8 items-center gap-1 pr-0.5 pl-1.5 text-[11px]">
        <ComputerActivity familiar={familiar} className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Full screen"
          onClick={() => show('full')}
        >
          <ArrowsOutIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => show(undefined)}
        >
          <XIcon />
        </Button>
      </div>
      <button
        type="button"
        aria-label="Full screen"
        onClick={() => show('full')}
        className="block w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ComputerScreen familiar={familiar} input={false} />
      </button>
    </div>
  )
}
