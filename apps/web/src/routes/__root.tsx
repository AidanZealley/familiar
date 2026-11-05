import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppError, connectionProblems } from '@/components/app-error'
import { AppLoader } from '@/components/app-loader'
import { SiteHeader } from '@/components/site-header'
import { Toaster } from '@/components/ui/sonner'
import { useFamiliar } from '@/lib/familiar'
import { useTheme } from '@/lib/theme'

// Below the header, clear of the composer on a phone.
const toastOffset = { top: 'calc(var(--chrome) + 0.5rem)' }

const Root = () => {
  const { theme } = useTheme()
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
      {/* Ours, not next-themes', which shadcn's Toaster reads by default. */}
      <Toaster
        theme={theme}
        position="top-center"
        offset={toastOffset}
        mobileOffset={toastOffset}
      />
    </div>
  )
}

export const Route = createRootRoute({ component: Root })
