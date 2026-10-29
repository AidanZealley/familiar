import { getRouteApi } from '@tanstack/react-router'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { SecretField } from './components/secret-field'

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
        description="Keys for the services Familiar uses. Each is sent only where it says. Stored keys are not displayed."
      />
      {sorted.length ? (
        <ul className="flex flex-col gap-3">
          {sorted.map((connection) => (
            <li
              key={`${connection.kind}/${connection.name}`}
              className="rounded-lg border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{connection.title}</h2>
                {!connection.secrets.length && (
                  <Badge variant="outline">Built in</Badge>
                )}
              </div>
              {connection.secrets.length > 0 && (
                <div className="mt-3 flex flex-col gap-4">
                  {connection.secrets.map((secret) => (
                    <SecretField
                      key={secret.name}
                      connection={{
                        kind: connection.kind,
                        name: connection.name,
                      }}
                      secret={secret}
                    />
                  ))}
                </div>
              )}
            </li>
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
