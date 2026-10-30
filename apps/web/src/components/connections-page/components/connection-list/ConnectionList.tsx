import { getRouteApi } from '@tanstack/react-router'
import { PlusIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  onAdd,
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
        'flex w-full min-w-0 flex-col md:w-80 md:shrink-0 md:border-r',
        className,
      )}
    >
      <div className="flex flex-col gap-3 px-4 pt-6 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-medium">Connections</h1>
          <Button variant="outline" onClick={onAdd}>
            <PlusIcon />
            Add server
          </Button>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search connections"
            placeholder="Names, addresses or tools"
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
        className="flex flex-col gap-4 px-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:flex-1 md:overflow-y-auto"
      >
        {groups.map(({ title, items }) => (
          <section key={title} aria-label={title}>
            <h2 className="flex justify-between px-2 pb-1 text-xs font-medium text-muted-foreground">
              {title}
              <span className="tabular-nums">{items.length}</span>
            </h2>
            <ul className="flex flex-col">
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
