import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { useCapability } from '@/components/capability-switch'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { ComputerSystemDetails } from '@/components/computer-system-details'
import { Button } from '@/components/ui/button'
import { computerPlugin, computerQuery } from '@/lib/computers'
import { useCapabilitySource } from '../../useCapabilitySource'
import { RemoveComputerDialog } from '../remove-computer-dialog'
import { ComputerLogins } from './components/computer-logins'
import { ComputerStatus } from './components/computer-status'
import { GiveComputer } from './components/give-computer'
import type { ComputerSettingsProps } from './types'

/**
 * A Familiar's computer: the offer to give it one, or how it is, its
 * system details (the popover's, shown in full) and how to remove it. Whether it has one is its `computer` capability, the same one
 * the Tools page switches; how the computer is comes from its host.
 */
export const ComputerSettings = ({ familiar }: ComputerSettingsProps) => {
  const capability = useCapability(
    useCapabilitySource(familiar),
    computerPlugin,
  )
  const { data: status, error: statusError } = useQuery(
    computerQuery(familiar.id),
  )
  const [confirming, setConfirming] = useState(false)

  if (capability.on === undefined) {
    return capability.error ? (
      <p className="text-sm text-destructive">{capability.error.message}</p>
    ) : (
      <span
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <HourglassSpinner />
        Loading {familiar.name}'s computer…
      </span>
    )
  }
  if (!capability.on) {
    return (
      <GiveComputer
        familiar={familiar}
        status={status}
        disabled={capability.busy}
        error={capability.error?.message}
        onGive={() => capability.set(true)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-8 text-sm">
      <section className="flex flex-col gap-4">
        <ComputerStatus
          familiar={familiar}
          status={status}
          error={statusError}
        />
        <ComputerSystemDetails familiar={familiar} status={status} />
      </section>
      <ComputerLogins key={familiar.id} familiar={familiar} />
      <section className="flex flex-col items-start gap-3 border-t pt-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-heading font-medium">Remove computer</h3>
          <p className="text-muted-foreground">
            Deletes it and everything on its disk. {familiar.name} can be given
            a new one after.
          </p>
        </div>
        <Button
          variant="destructive"
          disabled={capability.busy}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon />
          Remove computer
        </Button>
        {capability.error && (
          <p className="text-destructive">{capability.error.message}</p>
        )}
      </section>
      <RemoveComputerDialog
        familiar={familiar}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => capability.set(false)}
      />
    </div>
  )
}
