import { useSyncExternalStore } from 'react'

const phone = window.matchMedia('(width < 48rem)')
const watchPhone = (change: () => void) => {
  phone.addEventListener('change', change)
  return () => phone.removeEventListener('change', change)
}

/**
 * Below Tailwind's `md`: the phone layout, where a conversation and each
 * settings category take the whole screen.
 */
export const useIsPhone = () =>
  useSyncExternalStore(watchPhone, () => phone.matches)
