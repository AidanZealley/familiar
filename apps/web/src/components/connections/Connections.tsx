import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PixelCat } from '@/components/pixel-cat'
import { AddServerForm } from './components/add-server-form'
import { ConnectionDetail } from './components/connection-detail'
import { ConnectionDrawer } from './components/connection-drawer'
import { ConnectionList } from './components/connection-list'
import { ConnectionsError } from './components/connections-error'
import { CredentialsForm } from './components/credentials-form'
import { connectionsQuery } from './query'
import { idOf, statusOf } from './status'
import type { DrawerState } from './types'

/**
 * Settings › Connections: the list, then the selected connection, whose
 * own back button returns to the list. A removed one is no longer found, so
 * the list shows again.
 */
export const Connections = () => {
  const { data: connections, error, refetch } = useQuery(connectionsQuery)
  const [id, setId] = useState<string>()
  const [query, setQuery] = useState('')
  const [drawer, setDrawer] = useState<DrawerState>()

  if (!connections) {
    return error ? (
      <ConnectionsError error={error} onRetry={() => void refetch()} />
    ) : (
      <span role="status" aria-label="Loading">
        <PixelCat animated className="size-8" />
      </span>
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
          onBack={() => setId(undefined)}
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
          <ConnectionList
            connections={sorted}
            query={query}
            onQuery={setQuery}
            onSelect={setId}
          />
        </div>
      )}
      <ConnectionDrawer
        open={drawer?.type === 'add'}
        onClose={() => setDrawer(undefined)}
        title="Add an MCP server"
        description="It connects in the background. Then choose which Familiars use it, in each one's Tools."
      >
        <AddServerForm
          onAdded={(name, tokenError) => {
            setId(`mcp:${name}`)
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
