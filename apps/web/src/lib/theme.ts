import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'

/**
 * The page's theme, applied as soon as this module loads so the first paint
 * and any startup error already have it. Follows the system while it's
 * `system`, and a change made in another tab.
 */

const STORAGE_KEY = 'theme'
const root = document.documentElement
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

const stored = (): Theme => {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

let theme = stored()

const isDark = () =>
  theme === 'dark' || (theme === 'system' && systemDark.matches)

function apply() {
  const dark = isDark()
  // Switch colours at once, rather than animating everything that has a
  // colour transition.
  const still = document.createElement('style')
  still.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.append(still)
  root.classList.toggle('dark', dark)
  // Native controls such as scrollbars follow `color-scheme`, not the class.
  root.style.colorScheme = dark ? 'dark' : 'light'
  void getComputedStyle(root).color
  requestAnimationFrame(() => requestAnimationFrame(() => still.remove()))
  listeners.forEach((listener) => listener())
}

apply()
systemDark.addEventListener('change', apply)
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    theme = stored()
    apply()
  }
})

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const setTheme = (next: Theme) => {
  localStorage.setItem(STORAGE_KEY, next)
  theme = next
  apply()
}

/** The chosen theme, whether the page is dark now, and the means to change it. */
export const useTheme = () => ({
  theme: useSyncExternalStore(subscribe, () => theme),
  dark: useSyncExternalStore(subscribe, isDark),
  setTheme,
})
