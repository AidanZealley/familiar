import type { UsageMeterProps } from './types'

/** An amount in use, with a bar against its limit when it has one. */
export const UsageMeter = ({ label, usage, value }: UsageMeterProps) => {
  const share = usage.limit ? Math.min(usage.used / usage.limit, 1) : undefined

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      {share !== undefined && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={usage.limit}
          aria-valuenow={usage.used}
          aria-valuetext={value}
          className="h-1 bg-muted"
        >
          <div
            className="h-full bg-foreground/70"
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
