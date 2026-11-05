import { BellIcon, BellOffIcon } from 'lucide-react'
import { IconTile } from '@/components/icon-tile'
import { Button } from '@/components/ui/button'
import { useNotifications, type NotificationStatus } from './notifications'

const explanations: Record<NotificationStatus, string> = {
  checking: 'Checking this device…',
  unsupported:
    "This browser can't receive them. On an iPhone, open Familiar from the home screen; elsewhere, use the HTTPS address.",
  off: 'Get each scheduled reply on this device, even with Familiar closed.',
  on: 'This device gets each scheduled reply.',
  blocked:
    "Notifications are blocked for Familiar. Allow them in this browser's site settings, then come back.",
}

/** Whether this device gets notifications, and the one button that changes it. */
export const NotificationSetting = () => {
  const { status, busy, error, enable, disable } = useNotifications()
  const on = status === 'on'

  return (
    <section className="flex items-center gap-3 border bg-card p-3">
      <IconTile icon={on ? BellIcon : BellOffIcon} />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">Notifications</h2>
        <p className="text-xs text-muted-foreground">{explanations[status]}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {(status === 'off' || on) && (
        <Button
          variant={on ? 'outline' : 'default'}
          disabled={busy}
          onClick={on ? disable : enable}
        >
          {on ? 'Turn off' : 'Enable'}
        </Button>
      )}
    </section>
  )
}
