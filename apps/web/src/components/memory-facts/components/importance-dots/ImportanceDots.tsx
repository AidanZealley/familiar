import { cn } from 'cn'
import type { ImportanceDotsProps } from './types'

export const ImportanceDots = ({ importance }: ImportanceDotsProps) => (
  <span
    className="inline-flex items-center gap-0.5"
    role="img"
    aria-label={`Importance ${importance} of 5`}
    title={`Importance ${importance} of 5`}
  >
    {[1, 2, 3, 4, 5].map((level) => (
      <span
        key={level}
        className={cn(
          'size-1.5 rounded-full',
          level <= importance ? 'bg-foreground/60' : 'bg-foreground/15',
        )}
      />
    ))}
  </span>
)
