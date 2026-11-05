import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

/** The first load failed; later polls keep the last list instead. */
export const ConnectionsError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Couldn't load connections</EmptyTitle>
        <EmptyDescription>{(error as Error).message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}
