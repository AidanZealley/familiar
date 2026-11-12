import { createRootRoute, Outlet, useMatch } from '@tanstack/react-router'
import { cn } from 'cn'
import { AppError } from '@/components/app-error'
import { AppLoader } from '@/components/app-loader'
import { Dialogs } from '@/components/dialogs'
import { Sidebar } from '@/components/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { connectionProblems } from '@/lib/connection-problems'
import { dialogSearch } from '@/lib/dialogs'
import { useWorkspace } from '@/lib/familiar'
import { useTheme } from '@/lib/theme'

// Below a conversation's header, clear of the composer on a phone.
const toastOffset = { top: 'calc(var(--chrome) + 0.5rem)' }

/**
 * The sidebar beside the open conversation, and any dialog over them. On a
 * phone, one at a time: the sidebar is home, and a conversation takes the
 * whole screen.
 */
const Shell = () => {
  const { theme } = useTheme()
  const home = useMatch({ from: '/', shouldThrow: false }) !== undefined

  return (
    <div className="flex h-(--app-height) overflow-hidden">
      <Sidebar
        className={cn('w-full md:w-72 md:border-r', !home && 'max-md:hidden')}
      />
      <main
        className={cn(
          'relative flex min-w-0 flex-1 flex-col',
          home && 'max-md:hidden',
        )}
      >
        <Outlet />
      </main>
      <Dialogs />
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

/** The app, once the workspace's stream has said who and what is in it. */
const Root = () => {
  const ready = useWorkspace(
    (state) => state.familiars !== undefined && state.rooms !== undefined,
  )
  const connection = useWorkspace((state) => state.connection)

  if (ready) {
    return <Shell />
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

export const Route = createRootRoute({
  validateSearch: dialogSearch,
  component: Root,
  errorComponent: AppError,
})
