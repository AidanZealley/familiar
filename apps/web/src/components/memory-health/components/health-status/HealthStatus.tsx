import {
  CircleCheckIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { cn } from 'cn'
import type { HealthStatusProps } from './types'

// Status always pairs an icon with its label, so it never rests on colour.
const statuses = {
  good: {
    icon: CircleCheckIcon,
    label: 'Good',
    className: 'text-emerald-700 dark:text-emerald-400',
  },
  warning: {
    icon: TriangleAlertIcon,
    label: 'Needs attention',
    className: 'text-amber-700 dark:text-amber-400',
  },
  idle: {
    icon: CircleDashedIcon,
    label: 'Not measured yet',
    className: 'text-muted-foreground',
  },
}

export const HealthStatus = ({ status }: HealthStatusProps) => {
  const { icon: Icon, label, className } = statuses[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}
