import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { idOf, needsAttention, whereOf } from '../../status'
import { ConnectionRow } from './components/connection-row'
import type { ConnectionListProps } from './types'

export const ConnectionList = ({
  connections,
  query,
  onQuery,
  onSelect,
}: ConnectionListProps) => {
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search connections"
          placeholder="Search connections"
          autoComplete="off"
          spellCheck={false}
          className="pl-8"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <nav aria-label="Connections" className="flex flex-col gap-4">
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
                    onSelect={() => onSelect(idOf(connection))}
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
