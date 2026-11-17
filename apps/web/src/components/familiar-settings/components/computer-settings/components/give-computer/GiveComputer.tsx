import { useMutation } from '@tanstack/react-query'
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
import { pairComputer, provideComputer } from '@/lib/computers'
import { queryClient } from '@/lib/familiar'
import type { GiveComputerProps } from './types'

/**
 * Gives a Familiar a computer: one the host runs, when it can, or a machine
 * the owner pairs by running the agent on it.
 */
export const GiveComputer = ({
  familiar,
  provider,
  onPaired,
}: GiveComputerProps) => {
  const give = useMutation({
    mutationFn: async (kind: 'provided' | 'paired') => {
      if (kind === 'provided') {
        await provideComputer(familiar.id)
      } else {
        onPaired(await pairComputer(familiar.id))
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['computer', familiar.id] }),
  })

  return (
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
            <Button
              disabled={give.isPending}
              onClick={() => give.mutate('provided')}
            >
              <DesktopTowerIcon />
              Give a computer
            </Button>
            <Button
              variant="outline"
              disabled={give.isPending}
              onClick={() => give.mutate('paired')}
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
            <Button
              disabled={give.isPending}
              onClick={() => give.mutate('paired')}
            >
              <LinkIcon />
              Pair a machine
            </Button>
          </>
        )}
        {give.error && (
          <p className="text-sm text-destructive">{give.error.message}</p>
        )}
      </EmptyContent>
    </Empty>
  )
}
