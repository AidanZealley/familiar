import { DesktopTowerIcon, LinkIcon } from '@phosphor-icons/react'
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

/**
 * Gives a Familiar a computer: one the host runs, when it can, or a machine
 * the owner pairs by running the agent on it.
 */
export const GiveComputer = ({
  familiar,
  provider,
  pending,
  error,
  onGive,
}: GiveComputerProps) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <DesktopTowerIcon />
      </EmptyMedia>
      <EmptyTitle>Give {familiar.name} a computer</EmptyTitle>
      <EmptyDescription>
        A browser and a shell for {familiar.name} to work with. It sleeps when
        idle and wakes when needed.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      {provider ? (
        <>
          <Button disabled={pending} onClick={() => onGive('provide')}>
            <DesktopTowerIcon />
            Give a computer
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onGive('pair')}
          >
            <LinkIcon />
            Or pair a machine
          </Button>
        </>
      ) : (
        <>
          <EmptyDescription>
            This host can't run computers, but you can pair a machine of your
            own.
          </EmptyDescription>
          <Button disabled={pending} onClick={() => onGive('pair')}>
            <LinkIcon />
            Pair a machine
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </EmptyContent>
  </Empty>
)
