import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatAgo } from '@/lib/format'
import type { LastUpdateProps } from './types'

/** How the last update ended: the new version, or why it didn't happen. */
export const LastUpdate = ({ update, reloadFor }: LastUpdateProps) => (
  <div className="flex flex-col gap-2 border-t pt-4">
    <span className="text-xs text-muted-foreground">
      Last update
      {update.endedAt && `, ${formatAgo(Date.parse(update.endedAt))}`}
    </span>
    <span
      className={cn('text-sm', update.phase !== 'done' && 'text-destructive')}
    >
      {update.phase === 'done'
        ? `Updated from ${update.from} to ${update.to}.`
        : update.phase === 'interrupted'
          ? `The update stopped part way. Familiar is still on ${update.from}, unless it no longer starts; then run familiar update in a terminal.`
          : `The update failed${update.error ? `: ${update.error}` : ''}. Familiar is still on ${update.from}.`}
    </span>
    {reloadFor && (
      <Button
        size="sm"
        className="self-start"
        onClick={() => window.location.reload()}
      >
        Reload to use {reloadFor}
      </Button>
    )}
    {update.log && (
      <Collapsible>
        <CollapsibleTrigger
          render={<Button size="sm" variant="ghost" className="-ml-2" />}
        >
          Show log
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-48 overflow-auto bg-muted p-2 text-xs whitespace-pre-wrap">
            {update.log}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    )}
  </div>
)
