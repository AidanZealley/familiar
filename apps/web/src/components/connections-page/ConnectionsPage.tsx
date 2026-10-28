import { getRouteApi } from '@tanstack/react-router'
import { PageHeading } from '@/components/page-heading'
import { ConnectionItem } from './components/connection-item'

const route = getRouteApi('/connections')

export const ConnectionsPage = () => {
  const connections = route.useLoaderData()
  // Ones that need the owner first; built-in ones have nothing to set.
  const sorted = connections.toSorted(
    (a, b) =>
      Number(!a.secrets.length) - Number(!b.secrets.length) ||
      a.title.localeCompare(b.title),
  )

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <PageHeading
        title="Connections"
        description="Keys for the services Familiar uses. Each is sent only where it says, and never shown again, here or to Familiar."
      />
      {sorted.length ? (
        <ul className="flex flex-col gap-3">
          {sorted.map((connection) => (
            <ConnectionItem
              key={`${connection.kind}/${connection.name}`}
              connection={connection}
            />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing to connect: this Familiar has no plugins.
        </p>
      )}
    </main>
  )
}
