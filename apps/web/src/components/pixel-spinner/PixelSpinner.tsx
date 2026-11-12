import { cn } from 'cn'
import type { PixelSpinnerProps } from './types'

/** The ring's squares, clockwise from the top left. */
const RING = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const

/**
 * A pixel-art spinner for connection states: a 3×3 ring of squares, one lit
 * at a time, chasing round. Decorative: the text beside it says what's
 * happening. Reduced motion leaves the ring still and dim.
 */
export const PixelSpinner = ({ className }: PixelSpinnerProps) => (
  <svg
    aria-hidden
    viewBox="0 0 3 3"
    shapeRendering="crispEdges"
    className={cn('size-3 shrink-0', className)}
  >
    {RING.map(([x, y], index) => (
      <rect
        key={index}
        x={x}
        y={y}
        width={1}
        height={1}
        fill="currentColor"
        className="animate-pixel-spin opacity-25 motion-reduce:animate-none"
        style={{ animationDelay: `${index * 100}ms` }}
      />
    ))}
  </svg>
)
