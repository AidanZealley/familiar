import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { ToolListProps } from './types'

const absent = {
  connecting: 'Its tools appear once it connects.',
  'needs-auth': 'Its tools appear once it has a token the server accepts.',
  failed: "No tools while it can't connect.",
  disconnected: 'No tools while disconnected.',
}

export const ToolList = ({ connection }: ToolListProps) => {
  const [filter, setFilter] = useState('')
  const { tools } = connection
  const query = filter.trim().toLowerCase()
  const shown = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(query) ||
      !!tool.description?.toLowerCase().includes(query),
  )

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Tools{' '}
          <span className="font-normal text-muted-foreground tabular-nums">
            {tools.length}
          </span>
        </h3>
        {tools.length > 8 && (
          <Input
            type="search"
            aria-label="Filter tools"
            placeholder="Filter"
            autoComplete="off"
            spellCheck={false}
            className="max-w-44"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}
      </div>
      {!tools.length &&
      connection.kind === 'mcp' &&
      connection.status.type !== 'connected' ? (
        <p className="text-sm text-muted-foreground">
          {absent[connection.status.type]}
        </p>
      ) : shown.length ? (
        <ul className="flex flex-col divide-y border">
          {shown.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-0.5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-sm">{tool.name}</span>
                {'readOnly' in tool && tool.readOnly === true && (
                  <Badge variant="secondary">Reads only</Badge>
                )}
              </div>
              {tool.description && (
                <p className="line-clamp-3 text-xs text-muted-foreground">
                  {tool.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tools.length
            ? 'No tools match.'
            : 'This connection offers no tools.'}
        </p>
      )}
      {connection.kind === 'mcp' && (
        <p className="text-xs text-muted-foreground">
          Familiar finds these with tool search and calls them as{' '}
          <span className="font-mono">
            mcp__{connection.name}__<em>tool</em>
          </span>
          . "Reads only" is the server's own claim.
        </p>
      )}
    </section>
  )
}
