import {
  AlarmIcon,
  BrainIcon,
  CpuIcon,
  TrashIcon,
  UserIcon,
  WrenchIcon,
} from '@phosphor-icons/react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { ScheduleList } from '@/components/schedule-list'
import { SettingsDialog } from '@/components/settings-dialog'
import { FamiliarContext, familiarStreams } from '@/lib/familiar'
import { useStream } from '@/lib/streams'
import { useFamiliarSummary } from '@/lib/workspace'
import { MemorySettings } from './components/memory-settings'
import { ModelSettings } from './components/model-settings'
import { ProfileSettings } from './components/profile-settings'
import { RemoveFamiliar } from './components/remove-familiar'
import { ToolsSettings } from './components/tools-settings'
import type { FamiliarSettingsProps } from './types'

/** Everything about one Familiar, from its stream and the workspace's. */
export const FamiliarSettings = ({ id }: FamiliarSettingsProps) => {
  const familiar = useFamiliarSummary(id)
  const store = useStream(familiarStreams, familiar && id)

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
                id: 'model',
                label: 'Model',
                icon: CpuIcon,
                keywords: 'thinking reasoning',
                description: `What ${name} answers with, through the workspace's model account. Also in its DM's composer.`,
                content: <ModelSettings />,
              },
              {
                id: 'tools',
                label: 'Tools',
                icon: WrenchIcon,
                keywords: 'plugins connections mcp capabilities',
                description: `Which plugins and MCP servers ${name} uses. Add servers in Settings › Connections.`,
                content: <ToolsSettings familiar={familiar} />,
              },
              {
                id: 'memory',
                label: 'Memory',
                icon: BrainIcon,
                keywords: 'facts episodes history pinned core reserve',
                description: `What ${name} has filed from its conversations, each night, and the model that files it.`,
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
