import { DesktopTowerIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { GiveComputerProps } from './types'

/** The offer to give a Familiar a computer, or why this host can't yet. */
export const GiveComputer = ({
  familiar,
  status,
  disabled,
  error,
  onGive,
}: GiveComputerProps) => {
  const unavailable = status?.state === 'unavailable' ? status.reason : null

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DesktopTowerIcon />
        </EmptyMedia>
        <EmptyTitle>{familiar.name} has no computer</EmptyTitle>
        <EmptyDescription>
          A browser and a shell for {familiar.name} to work with, on the public
          internet only. It sleeps when idle and wakes when needed.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {unavailable && <EmptyDescription>{unavailable}</EmptyDescription>}
        <Button disabled={disabled || !!unavailable} onClick={onGive}>
          <DesktopTowerIcon />
          Give {familiar.name} a computer
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </EmptyContent>
    </Empty>
  )
}
