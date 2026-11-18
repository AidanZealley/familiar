import { ComputerActivity } from '@/components/computer-activity'
import { ComputerScreen } from '@/components/computer-screen'
import type { ComputerPaneProps } from './types'

/**
 * The Familiar's screen full screen, always fitted, with a bar saying what
 * it's doing. Beside the docked chat, the bar sits on top, level with the
 * chat's header; on a phone held upright, the screen is a band across the
 * top with the bar under it.
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
    {/* Beside the chat, lined up with its header; under the screen above it. */}
    <div className="flex h-12 shrink-0 items-center gap-2 border-border/60 bg-background px-3 text-xs docked:order-first docked:h-(--chrome) docked:border-b docked:px-4 docked:pt-(--status-bar) stacked:border-t">
      <ComputerActivity familiar={familiar} className="flex-1" />
    </div>
  </div>
)
