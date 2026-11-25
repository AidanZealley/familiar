import { HandPalmIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { toolName } from '../tool-call/label'
import type { ToolApprovalProps } from './types'

/**
 * Asks the person whether to run one call, showing the real tool and
 * arguments: for a Familiar's call, a card's control the owner wants
 * approved first, or a card's own confirmation.
 */
export const ToolApproval = ({
  tool,
  args,
  confirm,
  pending,
  error,
  onApprove,
  onDecline,
}: ToolApprovalProps) => {
  const name = toolName(tool)
  return (
    <div
      role="group"
      aria-label={confirm?.title ?? `Run ${name}?`}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Marker className="text-amber-600 dark:text-amber-400">
          <MarkerIcon>
            <HandPalmIcon />
          </MarkerIcon>
          <MarkerContent className="shimmer">
            Waiting for you · {confirm?.title ?? `Run ${name}?`}
          </MarkerContent>
        </Marker>
        <div className="flex gap-2">
          <Button size="xs" disabled={pending} onClick={onApprove}>
            {confirm?.confirmLabel ?? 'Approve'}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={onDecline}
          >
            {confirm?.cancelLabel ?? 'Decline'}
          </Button>
        </div>
      </div>
      <div className="ml-6 flex flex-col gap-2 border-l pl-3">
        {confirm && <p>{confirm.message}</p>}
        {confirm && <p className="text-xs text-muted-foreground">{name}</p>}
        <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(args, null, 2)}
        </pre>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
