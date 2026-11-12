import { cn } from 'cn'
import type { ImportanceMeterProps } from './types'

/** A fact's importance as five square pixels, filled up to it. */
export const ImportanceMeter = ({ importance }: ImportanceMeterProps) => (
  <span
    className="inline-flex gap-px"
    role="img"
    aria-label={`Importance ${importance} of 5`}
    title={`Importance ${importance} of 5`}
  >
    {[1, 2, 3, 4, 5].map((level) => (
      <span
        key={level}
        className={cn(
          'size-1.5',
          level <= importance ? 'bg-foreground/70' : 'bg-foreground/15',
        )}
      />
    ))}
  </span>
)
