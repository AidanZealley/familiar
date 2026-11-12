import {
  GearSixIcon,
  BellIcon,
  CpuIcon,
  PaletteIcon,
  PlugIcon,
  SparkleIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { Connections, useNeedsAttention } from '@/components/connections'
import { NotificationSetting } from '@/components/notification-setting'
import { SettingsDialog } from '@/components/settings-dialog'
import { Badge } from '@/components/ui/badge'
import { useWorkspace } from '@/lib/familiar'
import { AppearanceSettings } from './components/appearance-settings'
import { DefaultTools } from './components/default-tools'
import { ModelAccount } from './components/model-account'
import { YourProfile } from './components/your-profile'

/** The one Settings: you and this device, then the workspace. */
export const AppSettings = () => {
  const needsYou = useNeedsAttention()
  const me = useWorkspace((state) => state.me)

  return (
    <SettingsDialog
      title="Settings"
      // A tile the size of the other settings' portraits, so titles line up.
      media={
        <span className="grid size-8 shrink-0 place-items-center bg-muted">
          <GearSixIcon className="size-4" />
        </span>
      }
      groups={[
        {
          label: 'You',
          categories: [
            {
              id: 'profile',
              label: 'Profile',
              icon: UserIcon,
              keywords: 'name me rename',
              description: 'Who you are to every Familiar.',
              // Keyed by the name, so a rename from elsewhere reseeds it.
              content: me && <YourProfile key={me.name} me={me} />,
            },
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
              icon: SparkleIcon,
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
