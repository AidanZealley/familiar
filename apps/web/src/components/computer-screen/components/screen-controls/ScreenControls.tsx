import { cn } from 'cn'
import { TakeOverButton } from '@/components/take-over-button'
import { COMPACT } from './compact'
import { ScreenKeys } from './components/screen-keys'
import type { ScreenControlsProps } from './types'

/**
 * Over a full screen's corner (its bottom centre on a phone): Take over
 * while watching, and while this tab has control, its keys, then Hand back.
 */
export const ScreenControls = ({
  familiar,
  controlling,
  sendKey,
  attention,
}: ScreenControlsProps) => (
  <div
    // A click here is for these controls, never "take over to use it",
    // and leaves the keyboard's focus on the screen.
    onClick={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.preventDefault()}
    // Only the controls take clicks; the screen around them still does.
    className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center justify-center gap-1 *:pointer-events-auto docked:justify-end stacked:bottom-1 stacked:flex-nowrap"
  >
    {controlling && <ScreenKeys sendKey={sendKey} />}
    <TakeOverButton
      familiar={familiar}
      attention={attention}
      className={cn('shadow-lg', controlling && COMPACT)}
    />
  </div>
)
