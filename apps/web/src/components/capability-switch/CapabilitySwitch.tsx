import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import type { CapabilitySwitchProps } from './types'
import { useCapability } from './useCapability'

/**
 * Whether a Familiar, or each new one, uses a connection. Each opts in, so
 * a Familiar added later is off until it's switched on. With `confirmOff`,
 * switching it off asks first.
 */
export const CapabilitySwitch = ({
  connection,
  source,
  label,
  confirmOff,
}: CapabilitySwitchProps) => {
  const capability = useCapability(source, connection)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        aria-label={label}
        checked={capability.on ?? false}
        disabled={capability.busy}
        onCheckedChange={(on) =>
          !on && confirmOff ? setConfirming(true) : capability.set(on)
        }
      />
      {capability.error && (
        <p role="alert" className="text-xs text-destructive">
          {capability.error.message}
        </p>
      )}
      {confirmOff?.({
        open: confirming,
        onOpenChange: setConfirming,
        onConfirm: () => capability.set(false),
      })}
    </div>
  )
}
