import { HourglassSpinner } from '@/components/hourglass-spinner'
import { cn } from 'cn'
import type { StatusDotProps } from './types'

const colours = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
  // Opaque, so whatever it sits on, such as an icon, never shows through.
  off: 'bg-[color-mix(in_oklab,var(--muted-foreground)_50%,var(--background))]',
}

/** Decorative: the status label beside it says the same in words. */
export const StatusDot = ({ tone, className }: StatusDotProps) => (
  <span
    aria-hidden
    className={cn('grid size-4 shrink-0 place-items-center', className)}
  >
    {tone === 'busy' ? (
      <HourglassSpinner className="text-muted-foreground" />
    ) : (
      <span className={cn('size-2', colours[tone])} />
    )}
  </span>
)
