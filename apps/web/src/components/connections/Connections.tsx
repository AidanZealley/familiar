import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { pushedState } from '@/lib/dialogs'
import { AddServerForm } from './components/add-server-form'
import { ConnectionDetail } from './components/connection-detail'
import { ConnectionDrawer } from './components/connection-drawer'
import { ConnectionList } from './components/connection-list'
import { ConnectionsError } from './components/connections-error'
import { CredentialsForm } from './components/credentials-form'
import { connectionsQuery } from './query'
import { idOf, statusOf } from './status'
import type { DrawerState } from './types'

const route = getRouteApi('__root__')

/**
 * Settings › Connections: the list, then the selected connection. The
 * selection is in the URL, so Back returns to the list.
 */
export const Connections = () => {
  const navigate = route.useNavigate()
  const { data: connections, error, refetch } = useQuery(connectionsQuery)
  const { connection: id, q = '' } = route.useSearch()
  const [drawer, setDrawer] = useState<DrawerState>()

  if (!connections) {
    return error ? (
      <ConnectionsError error={error} onRetry={() => void refetch()} />
    ) : (
      <Spinner />
    )
  }

  const editing =
    drawer?.type === 'edit'
      ? connections.find((connection) => idOf(connection) === drawer.id)
      : undefined
  const sorted = connections.toSorted(
    (a, b) =>
      statusOf(a).rank - statusOf(b).rank || a.title.localeCompare(b.title),
  )
  const selected = sorted.find((connection) => idOf(connection) === id)

  return (
    <>
      {selected ? (
        <ConnectionDetail
          key={idOf(selected)}
          connection={selected}
          onEdit={() => setDrawer({ type: 'edit', id: idOf(selected) })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setDrawer({ type: 'add' })}
          >
            <PlusIcon />
            Add server
          </Button>
          <ConnectionList connections={sorted} query={q} />
        </div>
      )}
      <ConnectionDrawer
        open={drawer?.type === 'add'}
        onClose={() => setDrawer(undefined)}
        title="Add an MCP server"
        description="It connects in the background. Then choose which Familiars use it, in each one's Tools."
      >
        <AddServerForm
          onAdded={async (name, tokenError) => {
            await navigate({
              to: '.',
              search: (search) => ({ ...search, connection: `mcp:${name}` }),
              state: (previous) => pushedState(previous),
            })
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
    </>
  )
}
