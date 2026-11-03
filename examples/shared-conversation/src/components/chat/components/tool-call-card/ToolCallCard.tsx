import { CheckIcon, LoaderIcon, WrenchIcon, XIcon } from 'lucide-react'
import type { ToolCallCardProps } from './types'

const STATUS_ICONS = {
  running: <LoaderIcon className="size-3 animate-spin" aria-label="Running" />,
  done: <CheckIcon className="size-3" aria-label="Done" />,
  error: <XIcon className="size-3 text-destructive" aria-label="Failed" />,
}

/**
 * A tool Familiar ran, with the arguments the model chose. The reply that
 * follows is written from the tool's output.
 */
export const ToolCallCard = ({ call }: ToolCallCardProps) => {
  const args = Object.entries(call.arguments)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join(', ')

  return (
    <div className="flex items-center gap-1.5 border-l-2 border-primary/40 bg-muted/60 px-3 py-1.5 text-muted-foreground">
      <WrenchIcon className="size-3 shrink-0" aria-hidden />
      <code className="min-w-0 truncate">
        <span className="text-foreground">{call.name}</span>
        {args && ` ${args}`}
      </code>
      {STATUS_ICONS[call.status]}
    </div>
  )
}
