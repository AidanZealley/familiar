import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppError, connectionProblems } from '@/components/app-error'
import { AppLoader } from '@/components/app-loader'
import { SiteHeader } from '@/components/site-header'
import { useFamiliar } from '@/lib/familiar'

const Root = () => {
  // The first snapshot is the readiness signal and stays present on reconnect.
  const startup = useFamiliar((state) =>
    state.view === undefined ? state.connection : 'ready',
  )

  if (startup === 'connecting' || startup === 'reconnecting') {
    return <AppLoader />
  }
  if (startup !== 'ready' && startup !== 'open') {
    return <AppError description={connectionProblems[startup]} />
  }

  return (
    <div className="flex min-h-(--app-height) flex-col">
      <SiteHeader />
      <Outlet />
    </div>
  )
}

export const Route = createRootRoute({ component: Root })
