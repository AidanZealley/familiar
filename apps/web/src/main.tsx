import { FamiliarProvider } from '@familiar-ai/client/react'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { familiar } from './lib/familiar'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Only for notifications; the app never needs it to load.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FamiliarProvider store={familiar}>
      <RouterProvider router={router} />
    </FamiliarProvider>
  </StrictMode>,
)
