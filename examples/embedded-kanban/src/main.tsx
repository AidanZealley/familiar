import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { startDemo } from '@/assistant/demo'
import { FamiliarProvider } from '@familiar-ai/client/react'
import { BoardProvider } from '@/board/react'
import { CURRENT_AUTHOR } from '@/board/seed'
import { App } from '@/components/app'

// Follow the system's light or dark setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyScheme = () =>
  document.documentElement.classList.toggle('dark', dark.matches)
applyScheme()
dark.addEventListener('change', applyScheme)

const { board, store } = await startDemo()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BoardProvider board={board}>
      <FamiliarProvider store={store}>
        <App author={CURRENT_AUTHOR} />
      </FamiliarProvider>
    </BoardProvider>
  </StrictMode>,
)
