import { HandArrowUpIcon, HandGrabbingIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { Button } from '@/components/ui/button'
import { handBack, takeOver, useComputerControl } from '@/lib/computer-control'
import { computerQuery, computerDetailQuery } from '@/lib/computers'
import type { TakeOverButtonProps } from './types'

/**
 * Takes over the Familiar's computer, waking it if it sleeps, or hands it
 * back while this tab has it. Only for a computer that exists.
 */
export const TakeOverButton = ({
  familiar,
  attention = 0,
  className,
}: TakeOverButtonProps) => {
  const control = useComputerControl(familiar.id)
  const { data: status } = useQuery(computerQuery(familiar.id))
  const { data: detail } = useQuery(computerDetailQuery(familiar.id))
  const elsewhere = control === 'off' && detail?.control === 'person'
  const usable = status?.state === 'running' || status?.state === 'asleep'
  const label =
    control === 'held'
      ? 'Hand back'
      : control === 'taking'
        ? 'Taking over…'
        : elsewhere
          ? 'In use on another device'
          : status?.state === 'asleep'
            ? 'Wake and take over'
            : 'Take over'

  return (
    <Button
      // A new key replays the animation.
      key={attention}
      variant={control === 'held' ? 'outline' : 'default'}
      size="sm"
      disabled={control === 'off' && (!usable || elsewhere)}
      onClick={() =>
        control === 'off' ? takeOver(familiar) : handBack(familiar.id)
      }
      className={cn(attention > 0 && 'animate-attention', className)}
    >
      {control === 'held' ? (
        <HandArrowUpIcon />
      ) : control === 'taking' ? (
        <HourglassSpinner />
      ) : (
        <HandGrabbingIcon />
      )}
      {label}
    </Button>
  )
}
