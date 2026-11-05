import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useFamiliar } from '@/lib/familiar'
import type { CSSProperties } from 'react'
import { AppError } from '@/components/app-error'
import { AppLoader } from '@/components/app-loader'
import { SiteHeader } from '@/components/site-header'
import { ThemeProvider } from '@/components/theme-provider'

// The header's height, so pages can size and stick things below it.
const chrome = {
  '--page-width': '48rem',
  '--chrome': 'calc(3.5rem + var(--status-bar))',
} as CSSProperties

const startupErrors = {
  outdated: 'Familiar has been updated. Reload to use the latest version.',
  unauthorized: 'Access was refused. Check your connection and reload.',
  failed: 'Could not connect to Familiar. Check your connection and reload.',
}

const AppContent = () => {
  // The first snapshot is the readiness signal and stays present on reconnect.
  const startup = useFamiliar((state) =>
    state.view === undefined ? state.connection : 'ready',
  )

  if (startup === 'connecting' || startup === 'reconnecting') {
    return <AppLoader />
  }
  if (
    startup === 'outdated' ||
    startup === 'unauthorized' ||
    startup === 'failed'
  ) {
    return <AppError error={new Error(startupErrors[startup])} />
  }

  return (
    <div className="flex min-h-(--app-height) flex-col" style={chrome}>
      <SiteHeader />
      <Outlet />
    </div>
  )
}

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  ),
})
