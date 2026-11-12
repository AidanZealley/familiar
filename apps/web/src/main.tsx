import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/theme'
import { AppError } from './components/app-error'
import { AppLoader } from './components/app-loader'
import { portraitImagesQuery } from './lib/avatars'
import { queryClient } from './lib/familiar'
import { routeTree } from './routeTree.gen'

const router = createRouter({
  routeTree,
  defaultErrorComponent: AppError,
  defaultPendingComponent: AppLoader,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Alongside the workspace's stream, so portraits are there when it's ready.
void queryClient.prefetchQuery(portraitImagesQuery)

// Only for notifications; the app never needs it to load.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
