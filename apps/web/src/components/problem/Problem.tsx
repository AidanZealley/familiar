import { WarningCircleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { ProblemProps } from './types'

/**
 * Something that couldn't be shown, centred where it would have been: the
 * conversation pane, or the whole screen. One look for every error.
 */
export const Problem = ({
  title,
  description,
  action,
  details,
  className,
}: ProblemProps) => (
  <Empty role="alert" className={cn('flex-1', className)}>
    <EmptyHeader>
      <EmptyMedia variant="icon" className="text-destructive">
        <WarningCircleIcon />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      {description && <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
    {(action || details) && (
      <EmptyContent>
        {action}
        {details && (
          <details className="w-full text-left text-xs text-muted-foreground">
            <summary className="cursor-pointer text-center">
              Error details
            </summary>
            <pre className="mt-2 border bg-muted/40 p-3 font-mono wrap-anywhere whitespace-pre-wrap">
              {details}
            </pre>
          </details>
        )}
      </EmptyContent>
    )}
  </Empty>
)
