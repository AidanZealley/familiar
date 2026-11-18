import { ComputerActivity } from '@/components/computer-activity'
import { ComputerScreen } from '@/components/computer-screen'
import type { ComputerPaneProps } from './types'

/**
 * The Familiar's screen full screen, always fitted, over a bar saying what
 * it's doing. On a phone, a band across the top; otherwise the space
 * beside the docked chat.
 */
export const ComputerPane = ({ familiar }: ComputerPaneProps) => (
  <div className="flex shrink-0 flex-col bg-black pt-(--status-bar) md:min-w-0 md:flex-1 md:pt-0">
    <div className="[container-type:size] grid min-h-0 place-items-center max-md:[container-type:normal] md:flex-1 md:p-4">
      <ComputerScreen
        familiar={familiar}
        size="large"
        // Above the chat on a phone, at most 40% of the window's height, so the chat
        // keeps room in landscape.
        className="w-full max-w-[calc(40dvh*1.6)] md:max-w-[calc(100cqh*1.6)]"
      />
    </div>
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border/60 bg-popover px-3 text-xs">
      <ComputerActivity familiar={familiar} className="flex-1" />
    </div>
  </div>
)
