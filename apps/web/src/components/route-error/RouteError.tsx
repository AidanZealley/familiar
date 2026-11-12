import { useRouter } from '@tanstack/react-router'
import { HomeLink } from '@/components/home-link'
import { Problem } from '@/components/problem'
import { Button } from '@/components/ui/button'
import type { RouteErrorProps } from './types'

/**
 * A page that failed, in the conversation pane, beside the sidebar. Try
 * again reruns its loader and clears the error, short of reloading.
 */
export const RouteError = ({ error }: RouteErrorProps) => {
  const router = useRouter()

  return (
    <Problem
      title="Couldn't open this"
      description="Try again, or reload Familiar if it keeps happening."
      action={
        <>
          <Button onClick={() => router.invalidate()}>Try again</Button>
          <HomeLink />
        </>
      }
      details={error instanceof Error ? error.message : String(error)}
    />
  )
}
