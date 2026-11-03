import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { startDemo } from '@/demo/demo'
import { PEOPLE } from '@/demo/people'
import { App } from '@/components/app'

// Follow the system's light or dark setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyScheme = () =>
  document.documentElement.classList.toggle('dark', dark.matches)
applyScheme()
dark.addEventListener('change', applyScheme)

const demo = await startDemo(PEOPLE)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialDemo={demo} />
  </StrictMode>,
)
