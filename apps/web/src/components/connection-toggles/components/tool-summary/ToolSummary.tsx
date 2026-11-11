import { ChevronRightIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { ToolSummaryProps } from './types'

/** A connection's tools by name, opening to what each one does. */
export const ToolSummary = ({ tools }: ToolSummaryProps) => (
  <Collapsible className="min-w-0">
    <CollapsibleTrigger className="group/tools flex w-full min-w-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground">
      <ChevronRightIcon className="size-3 shrink-0 transition-transform group-data-[panel-open]/tools:rotate-90" />
      <span className="truncate font-mono">
        {tools.map((tool) => tool.name).join(', ')}
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <dl className="mt-2 flex flex-col gap-2 border-l pl-3 text-xs">
        {tools.map((tool) => (
          <div key={tool.name}>
            <dt className="font-mono">{tool.name}</dt>
            {tool.description && (
              <dd className="line-clamp-3 text-muted-foreground">
                {tool.description}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </CollapsibleContent>
  </Collapsible>
)
