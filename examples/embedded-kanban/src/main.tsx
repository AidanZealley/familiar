import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { startDemo } from '@/familiar/demo'
import { RoomProvider } from '@familiar-ai/client/react'
import { BoardProvider } from '@/board/react'
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
      <RoomProvider store={store}>
        <App />
      </RoomProvider>
    </BoardProvider>
  </StrictMode>,
)
