import { CORE_BUDGET } from '@familiar-ai/client'
import type { BudgetMeterProps } from './types'

const number = new Intl.NumberFormat()

/** How much of core's budget its facts use. */
export const BudgetMeter = ({ size }: BudgetMeterProps) => (
  <div className="flex flex-col gap-1.5">
    <div
      role="meter"
      aria-label="Core memory used"
      aria-valuemin={0}
      aria-valuemax={CORE_BUDGET}
      aria-valuenow={size}
      className="h-1.5 bg-muted"
    >
      <div
        className="h-full bg-foreground/60"
        style={{ width: `${Math.min(100, (size / CORE_BUDGET) * 100)}%` }}
      />
    </div>
    <p className="text-xs text-muted-foreground tabular-nums">
      Core uses {number.format(size)} of {number.format(CORE_BUDGET)} characters
    </p>
  </div>
)
