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

const touch = window.matchMedia('(pointer: coarse)')
const watchTouch = (change: () => void) => {
  touch.addEventListener('change', change)
  return () => touch.removeEventListener('change', change)
}

/**
 * A touch screen is the main pointer: a phone or tablet, whose keyboard and
 * native menus behave unlike a desktop's.
 */
export const useIsTouch = () =>
  useSyncExternalStore(watchTouch, () => touch.matches)

const watchVisibility = (change: () => void) => {
  document.addEventListener('visibilitychange', change)
  return () => document.removeEventListener('visibilitychange', change)
}

/** Whether the page is on screen: not in a background tab, or minimised. */
export const useIsVisible = () =>
  useSyncExternalStore(
    watchVisibility,
    () => document.visibilityState === 'visible',
  )
