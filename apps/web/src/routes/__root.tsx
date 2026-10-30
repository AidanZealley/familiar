import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { SiteHeader } from '@/components/site-header'
import { ThemeProvider } from '@/components/theme-provider'

// The header's height, so pages can size and stick things below it.
const chrome = {
  '--page-width': '48rem',
  '--chrome': 'calc(3.5rem + var(--status-bar))',
} as CSSProperties

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <div className="flex min-h-(--app-height) flex-col" style={chrome}>
        <SiteHeader />
        <Outlet />
      </div>
    </ThemeProvider>
  ),
})
