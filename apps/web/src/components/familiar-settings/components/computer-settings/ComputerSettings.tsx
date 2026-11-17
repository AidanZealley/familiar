import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { computerQuery } from '@/lib/computers'
import { ComputerStatus } from './components/computer-status'
import { GiveComputer } from './components/give-computer'
import { PairingLink } from './components/pairing-link'
import { RemoveComputer } from './components/remove-computer'
import type { ComputerSettingsProps } from './types'

/**
 * A Familiar's computer: the offer to give it one, or how it is and how to
 * remove it. A paired machine's link is shown only when it's made, so this
 * holds it until the machine connects.
 */
export const ComputerSettings = ({ familiar }: ComputerSettingsProps) => {
  const { data: computer, error } = useQuery(computerQuery(familiar.id))
  const [link, setLink] = useState<string>()

  if (computer === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This host doesn't give Familiars computers.
      </p>
    )
  }
  if (!computer) {
    return error && <p className="text-sm text-destructive">{error.message}</p>
  }
  if (computer.status === 'none') {
    return (
      <GiveComputer
        familiar={familiar}
        provider={computer.provider}
        onPaired={setLink}
      />
    )
  }

  return (
    <div className="flex flex-col items-start gap-6">
      <ComputerStatus familiar={familiar} computer={computer} />
      {link && !computer.provided && computer.status === 'offline' && (
        <PairingLink link={link} />
      )}
      <RemoveComputer familiar={familiar} />
    </div>
  )
}
