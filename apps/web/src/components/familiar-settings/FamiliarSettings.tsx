import {
  AlarmIcon,
  BrainIcon,
  CpuIcon,
  DesktopTowerIcon,
  TrashIcon,
  UserIcon,
  WrenchIcon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { connectionsQuery } from '@/components/connections'
import { PixelAvatar } from '@/components/pixel-avatar'
import { ScheduleList } from '@/components/schedule-list'
import { SettingsDialog } from '@/components/settings-dialog'
import { computerPlugin } from '@/lib/computers'
import { FamiliarContext, familiarStreams } from '@/lib/familiar'
import { useStream } from '@/lib/streams'
import { useFamiliarSummary } from '@/lib/workspace'
import { ComputerSettings } from './components/computer-settings'
import { MemorySettings } from './components/memory-settings'
import { ModelsSettings } from './components/models-settings'
import { ProfileSettings } from './components/profile-settings'
import { RemoveFamiliar } from './components/remove-familiar'
import { ToolsSettings } from './components/tools-settings'
import type { FamiliarSettingsProps } from './types'

/** Everything about one Familiar, from its stream and the workspace's. */
export const FamiliarSettings = ({ id }: FamiliarSettingsProps) => {
  const familiar = useFamiliarSummary(id)
  const store = useStream(familiarStreams, familiar && id)
  // Only where the workspace has the computer plugin.
  const { data: connections } = useQuery(connectionsQuery)
  const computers = connections?.some(
    ({ kind, name }) =>
      kind === computerPlugin.kind && name === computerPlugin.name,
  )

  if (!familiar || !store) {
    return null
  }
  const { name } = familiar

  return (
    <FamiliarContext value={store}>
      <SettingsDialog
        title={name}
        media={<PixelAvatar familiar={familiar} />}
        groups={[
          {
            categories: [
              {
                id: 'profile',
                label: 'Profile',
                icon: UserIcon,
                keywords: 'name portrait avatar persona',
                description: `Who ${name} is. Asking ${name} in a conversation can change these too.`,
                content: <ProfileSettings key={id} familiar={familiar} />,
              },
              {
                id: 'models',
                label: 'Models',
                icon: CpuIcon,
                keywords: 'chat memory thinking reasoning default',
                description: `What ${name} answers and remembers with. Each follows the default in Settings › Models unless it's set here.`,
                content: <ModelsSettings familiar={familiar} />,
              },
              {
                id: 'tools',
                label: 'Tools',
                icon: WrenchIcon,
                keywords: 'plugins connections mcp capabilities',
                description: `Which plugins and MCP servers ${name} uses. Add servers in Settings › Connections.`,
                content: <ToolsSettings familiar={familiar} />,
              },
              ...(computers
                ? [
                    {
                      id: 'computer',
                      label: 'Computer',
                      icon: DesktopTowerIcon,
                      keywords: 'browser shell docker machine',
                      description: `A browser and shell ${name} works with, beyond what plugins reach.`,
                      content: <ComputerSettings familiar={familiar} />,
                    },
                  ]
                : []),
              {
                id: 'memory',
                label: 'Memory',
                icon: BrainIcon,
                keywords: 'notes pages profiles people forget',
                description: `What ${name} keeps from its conversations.`,
                content: <MemorySettings familiar={familiar} />,
              },
              {
                id: 'schedules',
                label: 'Schedules',
                icon: AlarmIcon,
                keywords: 'reminders repeat',
                description: `Reminders, and anything else ${name} does at a time. It makes them when asked, and runs each in the room it was made in.`,
                content: <ScheduleList name={name} />,
              },
            ],
          },
          {
            categories: [
              {
                id: 'remove',
                label: 'Remove',
                icon: TrashIcon,
                danger: true,
                keywords: 'delete',
                description: `Stops ${name}'s work and deletes its memory and schedules. Rooms keep what it said; its DM closes.`,
                content: <RemoveFamiliar familiar={familiar} />,
              },
            ],
          },
        ]}
      />
    </FamiliarContext>
  )
}
