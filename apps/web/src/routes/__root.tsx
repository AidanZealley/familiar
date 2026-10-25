import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppHeader } from '@/components/app-header'
import { ThemeProvider } from '@/components/theme-provider'

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <div className="mx-auto flex h-svh max-w-3xl flex-col">
        <AppHeader />
        <Outlet />
      </div>
    </ThemeProvider>
  ),
})
