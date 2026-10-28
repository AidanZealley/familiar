import { Badge } from '@/components/ui/badge'
import { SecretField } from './components/secret-field'
import type { ConnectionItemProps } from './types'

export const ConnectionItem = ({ connection }: ConnectionItemProps) => (
  <li className="rounded-lg border bg-card p-3">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-medium">{connection.title}</h2>
      {!connection.secrets.length && <Badge variant="outline">Built in</Badge>}
    </div>
    {connection.secrets.length > 0 && (
      <div className="mt-3 flex flex-col gap-4">
        {connection.secrets.map((secret) => (
          <SecretField
            key={secret.name}
            connection={{ kind: connection.kind, name: connection.name }}
            secret={secret}
          />
        ))}
      </div>
    )}
  </li>
)
