import { ChevronRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { ToolCallProps } from './types'

const STATUS_LABEL = { running: 'Running', done: 'Done', error: 'Failed' }

export const ToolCall = ({ call }: ToolCallProps) => (
  <Collapsible className="rounded-lg border text-sm">
    <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
      <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      <span className="font-mono">{call.name}</span>
      <Badge
        variant={call.status === 'error' ? 'destructive' : 'secondary'}
        className="ml-auto"
      >
        {STATUS_LABEL[call.status]}
      </Badge>
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-2 border-t px-3 py-2 font-mono text-xs">
      <pre className="whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(call.arguments, null, 2)}
      </pre>
      {call.output && <pre className="whitespace-pre-wrap">{call.output}</pre>}
    </CollapsibleContent>
  </Collapsible>
)
