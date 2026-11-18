import { useMatch, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'

/**
 * How the DM shows its Familiar's computer beside the chat: popped out over
 * it, or full screen with the chat docked. The popover's own preview isn't
 * one: it's the popover's.
 */
export type ComputerView = 'pop' | 'full'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** This entry was pushed by going full screen, so leaving goes back. */
    computerFull?: true
  }
}

/** The DM route's `validateSearch`: its view of the computer, if any. */
export const computerViewSearch = (
  search: Record<string, unknown>,
): { computer?: ComputerView } => ({
  computer:
    search.computer === 'pop' || search.computer === 'full'
      ? search.computer
      : undefined,
})

/**
 * The DM's view of its Familiar's computer, which lives in the URL's search
 * (`?computer=full`), as dialogs do: only a DM's, so the parameter means
 * nothing anywhere else. Going full screen pushes a history
 * entry, so a phone's Back leaves it; every other change replaces the URL.
 */
export const useComputerView = () => {
  const router = useRouter()
  const navigate = useNavigate()
  const view = useMatch({
    from: '/dm/$familiar',
    shouldThrow: false,
    select: (match) => match.search.computer,
  })

  const show = useMemo(() => {
    const go = (next: ComputerView | undefined) =>
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, computer: next }),
        ...(next === 'full'
          ? { state: { computerFull: true as const } }
          : { replace: true, state: (prev) => prev }),
      })
    return (next: ComputerView | undefined) => {
      if (!router.state.location.state.computerFull || next === 'full') {
        return void go(next)
      }
      // Back over the entry going full screen pushed, then on to `next`.
      const stop = router.history.subscribe(() => {
        stop()
        void go(next)
      })
      router.history.back()
    }
  }, [router, navigate])
  return { view, show }
}
