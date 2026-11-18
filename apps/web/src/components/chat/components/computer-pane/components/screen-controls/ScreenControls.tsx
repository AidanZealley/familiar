import { cn } from 'cn'
import { TakeOverButton } from '@/components/take-over-button'
import { COMPACT } from './compact'
import { ScreenKeys } from './components/screen-keys'
import type { ScreenControlsProps } from './types'

/**
 * Under a full screen: Take over while watching, and while this tab has
 * control, its keys, then Hand back. In the pane's bottom-right corner
 * beside the chat; a strip of its own below the screen on a phone.
 */
export const ScreenControls = ({
  familiar,
  controlling,
  sendKey,
  attention,
}: ScreenControlsProps) => (
  <div
    // Leaves the keyboard's focus on the screen.
    onMouseDown={(event) => event.preventDefault()}
    className="flex items-center justify-center gap-1 docked:absolute docked:right-4 docked:bottom-3.5 stacked:w-full stacked:py-1.5"
  >
    {controlling && <ScreenKeys sendKey={sendKey} />}
    <TakeOverButton
      familiar={familiar}
      attention={attention}
      className={cn(controlling && COMPACT)}
    />
  </div>
)
