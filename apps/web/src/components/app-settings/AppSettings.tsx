import {
  GearSixIcon,
  BellIcon,
  CpuIcon,
  DesktopTowerIcon,
  KeyIcon,
  PaletteIcon,
  PlugIcon,
  SparkleIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { Connections, useNeedsAttention } from '@/components/connections'
import { NotificationSetting } from '@/components/notification-setting'
import { SettingsDialog } from '@/components/settings-dialog'
import { Badge } from '@/components/ui/badge'
import { computerLimitQuery } from '@/lib/computers'
import { useWorkspace } from '@/lib/familiar'
import { AppearanceSettings } from './components/appearance-settings'
import { ComputerLimit } from './components/computer-limit'
import { DefaultTools } from './components/default-tools'
import { ModelDefaults } from './components/model-defaults'
import { Providers } from './components/providers'
import { YourProfile } from './components/your-profile'

/** The one Settings: you and this device, then the workspace. */
export const AppSettings = () => {
  const needsYou = useNeedsAttention()
  const me = useWorkspace((state) => state.me)
  // Only where the daemon keeps the limit.
  const { data: maxComputers } = useQuery(computerLimitQuery)

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
              id: 'models',
              label: 'Models',
              icon: CpuIcon,
              keywords: 'chat memory default thinking',
              description:
                "What every Familiar answers and remembers with, unless it has its own in its settings' Models.",
              content: <ModelDefaults />,
            },
            {
              id: 'providers',
              label: 'Providers',
              icon: KeyIcon,
              keywords:
                'api keys chatgpt sign in sign out openai anthropic claude google gemini xai grok openrouter',
              description:
                "Where Familiars' models come from. A provider's models are offered once it has a key, after Familiar restarts.",
              content: <Providers />,
            },
            ...(maxComputers != null
              ? [
                  {
                    id: 'computers',
                    label: 'Computers',
                    icon: DesktopTowerIcon,
                    keywords: 'computer limit docker browser shell',
                    description:
                      "How many computers Familiars may have. Each Familiar's own is in its settings' Computer.",
                    // Keyed by the limit, so a change from elsewhere reseeds it.
                    content: (
                      <ComputerLimit
                        key={maxComputers}
                        maxComputers={maxComputers}
                      />
                    ),
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  )
}
