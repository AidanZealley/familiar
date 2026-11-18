import { HandArrowUpIcon, HandGrabbingIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { Button } from '@/components/ui/button'
import { handBack, takeOver, useComputerControl } from '@/lib/computer-control'
import { computerQuery } from '@/lib/computers'
import type { TakeOverButtonProps } from './types'

/**
 * Takes over the Familiar's computer, waking it if it sleeps, or hands it
 * back while this tab has it. Only for a computer that exists.
 */
export const TakeOverButton = ({
  familiar,
  iconOnly = false,
  attention = 0,
  className,
}: TakeOverButtonProps) => {
  const control = useComputerControl(familiar.id)
  const { data: status } = useQuery(computerQuery(familiar.id))
  const usable = status?.state === 'running' || status?.state === 'asleep'
  const label =
    control === 'held'
      ? 'Hand back'
      : control === 'taking'
        ? 'Taking over…'
        : status?.state === 'asleep'
          ? 'Wake and take over'
          : 'Take over'

  return (
    <Button
      // A new key replays the animation.
      key={attention}
      variant={control === 'held' ? 'outline' : 'default'}
      size={iconOnly ? 'icon-sm' : 'sm'}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      disabled={control === 'off' && !usable}
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
      {!iconOnly && label}
    </Button>
  )
}
