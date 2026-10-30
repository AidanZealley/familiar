import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewportDebugState = {
  on: boolean
  setOn: (on: boolean) => void
}

/**
 * Whether the viewport debug overlay shows. Kept per device, since it checks
 * one device's layout, and set from the settings menu because a home-screen
 * app has no address bar to add a query to.
 */
export const useViewportDebug = create<ViewportDebugState>()(
  persist((set) => ({ on: false, setOn: (on) => set({ on }) }), {
    name: 'familiar-viewport-debug',
  }),
)
