import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { AppError } from '@/components/app-error'
import { AppLoader } from '@/components/app-loader'
import { SiteHeader } from '@/components/site-header'
import { Toaster } from '@/components/ui/sonner'
import { connectionProblems } from '@/lib/connection-problems'
import { home, useRoom, useWorkspace } from '@/lib/familiar'
import { useTheme } from '@/lib/theme'

// Below the header, clear of the composer on a phone.
const toastOffset = { top: 'calc(var(--chrome) + 0.5rem)' }

/** The app, once its Familiar and chat are found. */
const Ready = () => {
  const { theme } = useTheme()
  // The chat's first view is the readiness signal and stays present on reconnect.
  const startup = useRoom((state) =>
    state.view === undefined ? state.connection : 'ready',
  )

  if (
    startup === 'connecting' ||
    startup === 'reconnecting' ||
    startup === 'open'
  ) {
    return <AppLoader />
  }
  if (startup !== 'ready') {
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

const Root = () => {
  const found = useStore(home)
  const connection = useWorkspace((state) => state.connection)

  if (found.status === 'ready') {
    return <Ready />
  }
  if (found.status === 'failed') {
    return <AppError error={found.error} />
  }
  if (
    connection === 'connecting' ||
    connection === 'reconnecting' ||
    connection === 'open'
  ) {
    return <AppLoader />
  }
  return <AppError description={connectionProblems[connection]} />
}

export const Route = createRootRoute({ component: Root })
