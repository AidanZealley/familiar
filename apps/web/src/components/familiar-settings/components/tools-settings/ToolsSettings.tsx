import { useQuery } from '@tanstack/react-query'
import { CapabilitySwitch } from '@/components/capability-switch'
import { ConnectionToggles } from '@/components/connection-toggles'
import { connectionsQuery } from '@/components/connections'
import { useFamiliarStore } from '@/lib/familiar'
import type { ToolsSettingsProps } from './types'

/** Each of the workspace's plugins and MCP servers, switched on or off for this Familiar. */
export const ToolsSettings = ({ familiar }: ToolsSettingsProps) => {
  const store = useFamiliarStore()
  const { data: connections } = useQuery(connectionsQuery)
  const source = {
    key: ['capabilities', familiar.id],
    get: () => store.capabilities.get(),
    set: store.capabilities.set,
  }

  return (
    <ConnectionToggles
      connections={connections}
      toggle={(connection) => (
        <CapabilitySwitch
          connection={connection}
          source={source}
          label={`${familiar.name} uses ${connection.title}`}
        />
      )}
    />
  )
}
