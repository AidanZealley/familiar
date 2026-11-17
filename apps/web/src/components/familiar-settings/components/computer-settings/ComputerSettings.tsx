import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { useCapability } from '@/components/capability-switch'
import { PixelCat } from '@/components/pixel-cat'
import { Button } from '@/components/ui/button'
import { computerPlugin, computerQuery } from '@/lib/computers'
import { useCapabilitySource } from '../../useCapabilitySource'
import { RemoveComputerDialog } from '../remove-computer-dialog'
import { ComputerStatus } from './components/computer-status'
import { GiveComputer } from './components/give-computer'
import type { ComputerSettingsProps } from './types'

/**
 * A Familiar's computer: the offer to give it one, or how it is and how to
 * remove it. Whether it has one is its `computer` capability, the same one
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
      <span role="status" aria-label="Loading">
        <PixelCat animated className="size-8" />
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
    <div className="flex flex-col items-start gap-6">
      <ComputerStatus familiar={familiar} status={status} error={statusError} />
      <Button
        variant="destructive"
        disabled={capability.busy}
        onClick={() => setConfirming(true)}
      >
        <TrashIcon />
        Remove computer
      </Button>
      {capability.error && (
        <p className="text-sm text-destructive">{capability.error.message}</p>
      )}
      <RemoveComputerDialog
        familiar={familiar}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => capability.set(false)}
      />
    </div>
  )
}
