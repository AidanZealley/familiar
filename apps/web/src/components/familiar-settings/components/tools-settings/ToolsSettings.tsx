import { useQuery } from '@tanstack/react-query'
import { CapabilitySwitch } from '@/components/capability-switch'
import { ConnectionToggles } from '@/components/connection-toggles'
import { connectionsQuery } from '@/components/connections'
import { isComputer } from '@/lib/computers'
import { useCapabilitySource } from '../../useCapabilitySource'
import { RemoveComputerDialog } from '../remove-computer-dialog'
import type { ToolsSettingsProps } from './types'

/**
 * Each of the workspace's plugins and MCP servers, switched on or off for
 * this Familiar. Switching its computer off removes it, so that asks first.
 */
export const ToolsSettings = ({ familiar }: ToolsSettingsProps) => {
  const source = useCapabilitySource(familiar)
  const { data: connections } = useQuery(connectionsQuery)

  return (
    <ConnectionToggles
      connections={connections}
      toggle={(connection) => (
        <CapabilitySwitch
          connection={connection}
          source={source}
          label={`${familiar.name} uses ${connection.title}`}
          confirmOff={
            isComputer(connection)
              ? (dialog) => (
                  <RemoveComputerDialog familiar={familiar} {...dialog} />
                )
              : undefined
          }
        />
      )}
    />
  )
}
