import {
  ArrowsOutIcon,
  DesktopTowerIcon,
  PictureInPictureIcon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ComputerScreen } from '@/components/computer-screen'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useComputerView, type ComputerView } from '@/lib/computer-view'
import { computerQuery, computerStates, useHasComputer } from '@/lib/computers'
import { ComputerDetails } from './components/computer-details'
import type { ComputerButtonProps } from './types'

/**
 * The Familiar's computer at a glance: an icon with its state's dot, which
 * opens its live screen and details, from which the screen pops out over
 * the chat or goes full screen. Nothing while the Familiar has no computer.
 */
export const ComputerButton = ({ familiar }: ComputerButtonProps) => {
  const hasComputer = useHasComputer(familiar.id)
  const { data: status } = useQuery({
    ...computerQuery(familiar.id),
    enabled: hasComputer === true,
  })
  const [open, setOpen] = useState(false)
  const { show } = useComputerView()

  if (!hasComputer) {
    return null
  }
  const state = status && computerStates[status.state]
  const showView = (view: ComputerView) => {
    setOpen(false)
    show(view)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-1rem))] gap-3 p-3"
      >
        <div className="relative">
          <ComputerScreen familiar={familiar} />
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            <Button
              size="icon-sm"
              className="bg-black/60 text-white hover:bg-black/80"
              aria-label="Pop out over the chat"
              onClick={() => showView('pop')}
            >
              <PictureInPictureIcon />
            </Button>
            <Button
              size="icon-sm"
              className="bg-black/60 text-white hover:bg-black/80"
              aria-label="Full screen"
              onClick={() => showView('full')}
            >
              <ArrowsOutIcon />
            </Button>
          </div>
        </div>
        <ComputerDetails familiar={familiar} status={status} />
      </PopoverContent>
    </Popover>
  )
}
