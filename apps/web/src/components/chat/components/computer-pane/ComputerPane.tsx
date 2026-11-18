import { ComputerActivity } from '@/components/computer-activity'
import { ComputerScreen } from '@/components/computer-screen'
import type { ComputerPaneProps } from './types'

/**
 * The Familiar's screen full screen, always fitted, over a bar saying what
 * it's doing. On a phone held upright, a band across the top; otherwise
 * the space beside the docked chat.
 */
export const ComputerPane = ({ familiar }: ComputerPaneProps) => (
  <div className="flex shrink-0 flex-col bg-black docked:min-w-0 docked:flex-1 stacked:pt-(--status-bar)">
    <div className="grid min-h-0 place-items-center docked:[container-type:size] docked:flex-1 docked:p-4">
      <ComputerScreen
        familiar={familiar}
        size="large"
        // Above the chat, at most 40% of the window's height, so the chat
        // keeps room; beside it, as big as fits.
        className="w-full docked:max-w-[calc(100cqh*1.6)] stacked:max-w-[calc(40dvh*1.6)]"
      />
    </div>
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border/60 bg-popover px-3 text-xs">
      <ComputerActivity familiar={familiar} className="flex-1" />
    </div>
  </div>
)
