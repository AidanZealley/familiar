import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { idOf, statusOf, whereOf } from '../../../../status'
import { StatusDot } from '../../../status-dot'
import type { ConnectionRowProps } from './types'

export const ConnectionRow = ({
  connection,
  tools,
  selected,
}: ConnectionRowProps) => {
  const status = statusOf(connection)
  // Healthy servers show how many tools they bring; others, what's wrong.
  const summary =
    connection.kind === 'mcp' && connection.status.type === 'connected'
      ? `${connection.tools.length} tools`
      : status.label

  return (
    <Link
      to="/connections"
      search={(search) => ({ ...search, id: idOf(connection) })}
      aria-current={selected ? 'page' : undefined}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 px-2 py-2 text-sm hover:bg-muted aria-[current=page]:bg-muted"
    >
      <StatusDot tone={status.tone} />
      <span className="truncate font-medium">{connection.title}</span>
      <span className="text-xs text-muted-foreground">{summary}</span>
      <span
        className={cn(
          'col-start-2 col-end-4 truncate text-xs text-muted-foreground',
          connection.kind === 'mcp' && 'font-mono',
        )}
      >
        {whereOf(connection)}
      </span>
      {tools.length > 0 && (
        <span className="col-start-2 col-end-4 truncate text-xs">
          Tools: <span className="font-mono">{tools.join(', ')}</span>
        </span>
      )}
    </Link>
  )
}
