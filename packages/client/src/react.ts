import { useContext } from 'react'
import { useStore } from 'zustand'
import { FamiliarContext } from './context.ts'
import type { FamiliarState } from './store.ts'

export { FamiliarProvider } from './components/familiar-provider/index.ts'
export type { FamiliarProviderProps } from './components/familiar-provider/index.ts'

/** Selects state from the nearest provider, using Zustand's Object.is comparison. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T => {
  const store = useContext(FamiliarContext)
  if (!store) {
    throw new Error('useFamiliar must be used within a FamiliarProvider')
  }
  return useStore(store, selector)
}

/** Reads the transcript derived and cached by the store. */
export const useTranscript = () => useFamiliar((state) => state.transcript)
