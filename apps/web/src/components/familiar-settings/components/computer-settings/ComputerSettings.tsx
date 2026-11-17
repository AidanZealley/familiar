import { useMutation, useQuery } from '@tanstack/react-query'
import { LinkIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  computerQuery,
  pairComputer,
  provideComputer,
  removeComputer,
} from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import { ComputerStatus } from './components/computer-status'
import { GiveComputer } from './components/give-computer'
import { PairingLink } from './components/pairing-link'
import { RemoveComputer } from './components/remove-computer'
import type { ComputerSettingsProps } from './types'

/**
 * A Familiar's computer: the offer to give it one, or how it is and how to
 * remove it. Giving, pairing and removing run here, one at a time, so the
 * controls stay put and disabled until the request finishes, however the
 * polled status changes meanwhile. The pairing link is the result of the last
 * pairing, shown until the machine connects.
 */
export const ComputerSettings = ({ familiar }: ComputerSettingsProps) => {
  const query = computerQuery(familiar.id)
  const { data: computer, error, isRefetchError } = useQuery(query)
  const lifecycle = useMutation({
    mutationFn: async (action: 'provide' | 'pair' | 'remove') => {
      if (action === 'provide') {
        await provideComputer(familiar.id)
      } else if (action === 'remove') {
        await removeComputer(familiar.id)
      } else {
        return pairComputer(familiar.id)
      }
    },
    // The request may have changed the computer even when it failed.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: query.queryKey }),
  })

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
        pending={lifecycle.isPending}
        error={lifecycle.error?.message}
        onGive={(action) => lifecycle.mutate(action)}
      />
    )
  }

  const pairedOffline = !computer.provided && computer.status === 'offline'
  return (
    <div className="flex flex-col items-start gap-6">
      <ComputerStatus
        familiar={familiar}
        computer={computer}
        refreshError={isRefetchError ? error : null}
      />
      {pairedOffline && lifecycle.data && <PairingLink link={lifecycle.data} />}
      <div className="flex gap-2">
        {pairedOffline && (
          <Button
            variant="outline"
            disabled={lifecycle.isPending}
            onClick={() => lifecycle.mutate('pair')}
          >
            <LinkIcon />
            Pair again
          </Button>
        )}
        <RemoveComputer
          familiar={familiar}
          provided={computer.provided}
          disabled={lifecycle.isPending}
          onRemove={() => lifecycle.mutate('remove')}
        />
      </div>
      {lifecycle.error && (
        <p className="text-sm text-destructive">{lifecycle.error.message}</p>
      )}
    </div>
  )
}
