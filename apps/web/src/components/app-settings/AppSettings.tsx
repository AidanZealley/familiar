import { useQuery } from '@tanstack/react-query'
import {
  BellIcon,
  CpuIcon,
  PaletteIcon,
  PlugIcon,
  SparklesIcon,
} from 'lucide-react'
import {
  Connections,
  connectionsQuery,
  needsAttention,
} from '@/components/connections'
import { NotificationSetting } from '@/components/notification-setting'
import { SettingsDialog } from '@/components/settings-dialog'
import { Badge } from '@/components/ui/badge'
import { AppearanceSettings } from './components/appearance-settings'
import { DefaultTools } from './components/default-tools'
import { ModelAccount } from './components/model-account'

/** The one Settings: this device, then the workspace. */
export const AppSettings = () => {
  const { data: connections = [] } = useQuery(connectionsQuery)
  const needsYou = connections.filter(needsAttention).length

  return (
    <SettingsDialog
      title="Settings"
      groups={[
        {
          label: 'You',
          categories: [
            {
              id: 'appearance',
              label: 'Appearance',
              icon: PaletteIcon,
              keywords: 'theme dark light system',
              description: 'On this device.',
              content: <AppearanceSettings />,
            },
            {
              id: 'notifications',
              label: 'Notifications',
              icon: BellIcon,
              keywords: 'push device schedules',
              description: 'On this device.',
              content: <NotificationSetting />,
            },
          ],
        },
        {
          label: 'Workspace',
          categories: [
            {
              id: 'connections',
              label: 'Connections',
              icon: PlugIcon,
              keywords: 'mcp servers plugins tokens keys',
              description:
                "MCP servers and plugins. Each Familiar chooses which it uses, in its own settings' Tools.",
              badge: needsYou > 0 && (
                <Badge
                  variant="destructive"
                  aria-label={`${needsYou} need you`}
                >
                  {needsYou}
                </Badge>
              ),
              content: <Connections />,
            },
            {
              id: 'defaults',
              label: 'Default tools',
              icon: SparklesIcon,
              keywords: 'new familiar capabilities',
              description:
                "What a new Familiar starts with. Each Familiar's own are in its settings.",
              content: <DefaultTools />,
            },
            {
              id: 'account',
              label: 'Model account',
              icon: CpuIcon,
              keywords: 'chatgpt sign in sign out provider',
              description: 'Every Familiar answers through this sign-in.',
              content: <ModelAccount />,
            },
          ],
        },
      ]}
    />
  )
}
