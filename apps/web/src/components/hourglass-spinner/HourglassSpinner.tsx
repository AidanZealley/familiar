import {
  HourglassHighIcon,
  HourglassLowIcon,
  HourglassMediumIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import type { HourglassSpinnerProps } from './types'

// One cycle of the `hourglass` animation shows each frame for a third of it.
const CYCLE = 1500

/** The frames in order, each starting a third of a cycle after the last. */
const FRAMES = [
  { Icon: HourglassHighIcon, step: 0 },
  { Icon: HourglassMediumIcon, step: 1 },
  { Icon: HourglassLowIcon, step: 2 },
]

/**
 * A loader for connection states: an hourglass running down, high, medium,
 * low, then high again. Decorative: the text beside it says what's
 * happening. Reduced motion leaves it still, half run.
 */
export const HourglassSpinner = ({ className }: HourglassSpinnerProps) => (
  <span aria-hidden className={cn('grid size-3 shrink-0', className)}>
    {FRAMES.map(({ Icon, step }) => (
      <Icon
        key={step}
        className={cn(
          'size-full animate-hourglass opacity-0 [grid-area:1/1]',
          step === 1
            ? 'motion-reduce:animate-none motion-reduce:opacity-100'
            : 'motion-reduce:hidden',
        )}
        // Negative, so every frame runs from the start, a third apart.
        style={{ animationDelay: `${-((3 - step) % 3) * (CYCLE / 3)}ms` }}
      />
    ))}
  </span>
)
