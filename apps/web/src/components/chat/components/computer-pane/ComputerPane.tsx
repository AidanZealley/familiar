import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ComputerScreen, type ScreenHandle } from '@/components/computer-screen'
import { useComputerControl } from '@/lib/computer-control'
import { ScreenControls } from './components/screen-controls'
import type { ComputerPaneProps } from './types'

/**
 * The Familiar's screen full screen, always fitted: beside the docked chat,
 * or on a phone held upright, a band across the top above it. Its state
 * shows on the screen itself, as the cover a sleeping one wears. Take over
 * (and, while controlling, the keys and Hand back) sits under the screen,
 * never over it: in the pane's corner beside the chat, in a strip below it
 * on a phone. A click on the watched screen points to Take over.
 */
export const ComputerPane = ({ familiar }: ComputerPaneProps) => {
  const controlling = useComputerControl(familiar.id) === 'held'
  const screen = useRef<ScreenHandle>(null)
  // Bumped by a click on the watched screen, to point to Take over.
  const [attention, setAttention] = useState(0)

  return (
    <div className="relative grid shrink-0 place-items-center bg-black docked:[container-type:size] docked:min-w-0 docked:flex-1 docked:p-4 docked:pb-14">
      {/* Only to hear clicks on the screen: it lays nothing out. */}
      <div
        className="contents"
        onClick={
          controlling
            ? undefined
            : () => {
                toast('Take over to use it')
                setAttention((count) => count + 1)
              }
        }
      >
        <ComputerScreen
          ref={screen}
          familiar={familiar}
          size="large"
          // Above the chat, at most 40% of the window's height, so the chat
          // keeps room; beside it, as big as fits above the controls.
          className="w-full docked:max-w-[calc(100cqh*1.6)] stacked:max-w-[calc(40dvh*1.6)]"
        />
      </div>
      <ScreenControls
        familiar={familiar}
        controlling={controlling}
        sendKey={(...key) => screen.current?.sendKey(...key)}
        attention={attention}
      />
    </div>
  )
}
