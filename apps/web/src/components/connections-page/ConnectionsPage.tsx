import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AddServerForm } from './components/add-server-form'
import { ConnectionDetail } from './components/connection-detail'
import { ConnectionDrawer } from './components/connection-drawer'
import { ConnectionList } from './components/connection-list'
import { CredentialsForm } from './components/credentials-form'
import { idOf, statusOf } from './status'
import type { DrawerState } from './types'

const route = getRouteApi('/connections')

/**
 * The list beside the selected connection. On a phone, one at a time: the
 * selection in the URL decides which, so Back returns to the list.
 */
export const ConnectionsPage = () => {
  const router = useRouter()
  const navigate = route.useNavigate()
  const connections = route.useLoaderData()
  const { id, q = '' } = route.useSearch()
  const [drawer, setDrawer] = useState<DrawerState>()
  const editing =
    drawer?.type === 'edit'
      ? connections.find((connection) => idOf(connection) === drawer.id)
      : undefined

  const sorted = connections.toSorted(
    (a, b) =>
      statusOf(a).rank - statusOf(b).rank || a.title.localeCompare(b.title),
  )
  const selected =
    sorted.find((connection) => idOf(connection) === id) ?? sorted[0]

  // Fast while a server connects, so its outcome shows promptly.
  const connecting = connections.some(
    (connection) =>
      connection.kind === 'mcp' && connection.status.type === 'connecting',
  )
  useEffect(() => {
    const timer = setInterval(
      () => void router.invalidate(),
      connecting ? 1000 : 5000,
    )
    return () => clearInterval(timer)
  }, [router, connecting])

  return (
    <main className="mx-auto flex w-full max-w-(--page-width) flex-1 md:fixed md:inset-x-0 md:top-(--chrome) md:bottom-0 md:min-h-0 md:overflow-hidden">
      <ConnectionList
        className={cn(id && 'max-md:hidden')}
        connections={sorted}
        selectedId={selected && idOf(selected)}
        query={q}
        onAdd={() => setDrawer({ type: 'add' })}
      />
      {selected ? (
        <ConnectionDetail
          key={idOf(selected)}
          className={cn(!id && 'max-md:hidden')}
          connection={selected}
          onEdit={() => setDrawer({ type: 'edit', id: idOf(selected) })}
        />
      ) : (
        <p className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground max-md:hidden">
          Add an MCP server to give Familiar more tools.
        </p>
      )}
      <ConnectionDrawer
        open={drawer?.type === 'add'}
        onClose={() => setDrawer(undefined)}
        title="Add an MCP server"
        description="It connects in the background, and its tools become available to Familiar."
      >
        <AddServerForm
          onAdded={async (name, tokenError) => {
            await navigate({ search: { id: `mcp:${name}` } })
            // A token that failed to save leaves it waiting for one: ask again.
            setDrawer(
              tokenError
                ? { type: 'edit', id: `mcp:${name}`, error: tokenError }
                : undefined,
            )
          }}
        />
      </ConnectionDrawer>
      {editing && (
        <ConnectionDrawer
          key={idOf(editing)}
          open={drawer?.type === 'edit'}
          onClose={() => setDrawer(undefined)}
          title={`Edit ${editing.title}`}
          description="Saved keys are never shown. Enter a new one to replace it."
        >
          <CredentialsForm
            connection={editing}
            error={drawer?.type === 'edit' ? drawer.error : undefined}
            onDone={() => setDrawer(undefined)}
          />
        </ConnectionDrawer>
      )}
    </main>
  )
}
