import { useQuery } from '@tanstack/react-query'
import { CapabilitySwitch } from '@/components/capability-switch'
import { ConnectionToggles } from '@/components/connection-toggles'
import { connectionsQuery } from '@/components/connections'
import { workspace } from '@/lib/familiar'

const source = {
  key: ['default-capabilities'],
  get: workspace.defaults.capabilities,
  set: workspace.defaults.setCapabilities,
}

/** What each new Familiar starts with, connection by connection. */
export const DefaultTools = () => {
  const { data: connections } = useQuery(connectionsQuery)

  return (
    <ConnectionToggles
      connections={connections}
      toggle={(connection) => (
        <CapabilitySwitch
          connection={connection}
          source={source}
          label={`New Familiars use ${connection.title}`}
        />
      )}
    />
  )
}
