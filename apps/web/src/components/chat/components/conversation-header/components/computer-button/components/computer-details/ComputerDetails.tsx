import { CaretRightIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { ComputerSystemDetails } from '@/components/computer-system-details'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { StatusDot } from '@/components/status-dot'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { PopoverDescription, PopoverTitle } from '@/components/ui/popover'
import { computerDetailQuery, computerStates } from '@/lib/computers'
import type { ComputerDetailsProps } from './types'

/**
 * The Familiar's computer: its name and state, then its system details,
 * folded away so the popover keeps its height as they arrive.
 */
export const ComputerDetails = ({ familiar, status }: ComputerDetailsProps) => {
  const { isPending } = useQuery(computerDetailQuery(familiar.id))
  const state = status && computerStates[status.state]

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle className="truncate font-heading text-sm font-medium">
            {familiar.name}'s computer
          </PopoverTitle>
          {state && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <StatusDot tone={state.tone} />
              {state.label}
            </span>
          )}
        </div>
        {status?.state === 'unavailable' && (
          <PopoverDescription className="text-muted-foreground">
            {status.reason}
          </PopoverDescription>
        )}
      </div>
      <Collapsible>
        {/* Opens once there's something to show: until then, the hourglass
            in the caret's place and a faded label. */}
        <CollapsibleTrigger
          disabled={isPending}
          className="group/details flex w-full items-center gap-1 text-left text-muted-foreground not-disabled:hover:text-foreground disabled:text-muted-foreground/50"
        >
          {isPending ? (
            <HourglassSpinner />
          ) : (
            <CaretRightIcon className="size-3 shrink-0 transition-transform group-data-[panel-open]/details:rotate-90" />
          )}
          System details
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <ComputerSystemDetails familiar={familiar} status={status} />
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
