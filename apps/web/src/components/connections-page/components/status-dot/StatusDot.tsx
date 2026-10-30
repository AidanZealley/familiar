import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { StatusDotProps } from './types'

const colours = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
  off: 'bg-muted-foreground/50',
}

/** Decorative: the status label beside it says the same in words. */
export const StatusDot = ({ tone }: StatusDotProps) => (
  <span aria-hidden className="grid size-4 shrink-0 place-items-center">
    {tone === 'busy' ? (
      <Spinner aria-hidden className="size-3.5 text-muted-foreground" />
    ) : (
      <span className={cn('size-2 rounded-full', colours[tone])} />
    )}
  </span>
)
