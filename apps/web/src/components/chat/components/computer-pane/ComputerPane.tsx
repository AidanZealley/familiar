import { ComputerScreen } from '@/components/computer-screen'
import type { ComputerPaneProps } from './types'

/**
 * The Familiar's screen full screen, always fitted: beside the docked chat,
 * or on a phone held upright, a band across the top above it. Its state
 * shows on the screen itself, as the cover a sleeping one wears.
 */
export const ComputerPane = ({ familiar }: ComputerPaneProps) => (
  <div className="grid shrink-0 place-items-center bg-black docked:[container-type:size] docked:min-w-0 docked:flex-1 docked:p-4">
    <ComputerScreen
      familiar={familiar}
      size="large"
      // Above the chat, at most 40% of the window's height, so the chat
      // keeps room; beside it, as big as fits.
      className="w-full docked:max-w-[calc(100cqh*1.6)] stacked:max-w-[calc(40dvh*1.6)]"
    />
  </div>
)
