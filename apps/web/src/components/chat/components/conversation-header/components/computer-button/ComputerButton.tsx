import { DesktopTowerIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { computerQuery, computerStates, useHasComputer } from '@/lib/computers'
import { ComputerDetails } from './components/computer-details'
import type { ComputerButtonProps } from './types'

/**
 * The Familiar's computer at a glance: an icon with its state's dot, which
 * opens its details. Nothing while the Familiar has no computer.
 */
export const ComputerButton = ({ familiar }: ComputerButtonProps) => {
  const hasComputer = useHasComputer(familiar.id)
  const { data: status } = useQuery({
    ...computerQuery(familiar.id),
    enabled: hasComputer === true,
  })

  if (!hasComputer) {
    return null
  }
  const state = status && computerStates[status.state]

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative"
            aria-label={`${familiar.name}'s computer${state ? `: ${state.label}` : ''}`}
          />
        }
      >
        <DesktopTowerIcon />
        {state && (
          <StatusDot
            tone={state.tone}
            className="absolute right-1 bottom-1 size-3"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        {/* The live view's desktop preview goes here, above the details. */}
        <ComputerDetails familiar={familiar} status={status} />
      </PopoverContent>
    </Popover>
  )
}
