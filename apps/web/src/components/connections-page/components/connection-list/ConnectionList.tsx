import { getRouteApi } from '@tanstack/react-router'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { idOf, needsAttention, whereOf } from '../../status'
import { ConnectionRow } from './components/connection-row'
import type { ConnectionListProps } from './types'

const route = getRouteApi('/connections')

export const ConnectionList = ({
  className,
  connections,
  selectedId,
  query,
}: ConnectionListProps) => {
  const navigate = route.useNavigate()
  const needle = query.trim().toLowerCase()

  // Tool names match too, to answer "which one can start a print?"
  const results = connections.flatMap((connection) => {
    const tools =
      needle && connection.kind === 'mcp'
        ? connection.tools
            .map((tool) => tool.name)
            .filter((name) => name.toLowerCase().includes(needle))
        : []
    const text = `${connection.title} ${connection.name} ${whereOf(connection)}`
    return !needle || tools.length || text.toLowerCase().includes(needle)
      ? [{ connection, tools }]
      : []
  })
  const groups = [
    {
      title: 'Needs attention',
      items: results.filter(({ connection }) => needsAttention(connection)),
    },
    {
      title: 'MCP servers',
      items: results.filter(
        ({ connection }) =>
          connection.kind === 'mcp' && !needsAttention(connection),
      ),
    },
    {
      title: 'Plugins',
      items: results.filter(
        ({ connection }) =>
          connection.kind === 'plugin' && !needsAttention(connection),
      ),
    },
  ].filter(({ items }) => items.length)

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col md:min-h-0 md:w-60 md:shrink-0',
        className,
      )}
    >
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3 md:pr-0">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search connections"
            placeholder="Search connections"
            autoComplete="off"
            spellCheck={false}
            className="pl-8"
            value={query}
            onChange={(event) =>
              void navigate({
                search: (search) => ({
                  ...search,
                  q: event.target.value || undefined,
                }),
                replace: true,
              })
            }
          />
        </div>
      </div>
      <nav
        aria-label="Connections"
        className="flex flex-col gap-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-0"
      >
        {groups.map(({ title, items }) => (
          <section key={title} aria-label={title}>
            <h2 className="flex justify-between pb-1 text-xs font-medium text-muted-foreground">
              {title}
              <span className="tabular-nums">{items.length}</span>
            </h2>
            <ul className="flex flex-col gap-1">
              {items.map(({ connection, tools }) => (
                <li key={idOf(connection)}>
                  <ConnectionRow
                    connection={connection}
                    tools={tools}
                    selected={idOf(connection) === selectedId}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!groups.length && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {needle
              ? `Nothing matches "${query.trim()}".`
              : 'No connections yet.'}
          </p>
        )}
      </nav>
    </div>
  )
}
