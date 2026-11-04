import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  type ReactElement,
} from 'react'
import { useStore } from 'zustand'
import type { FamiliarStore, FamiliarState } from './store/types.ts'

export type FamiliarProviderProps = {
  /** Caller owns the store and its connection lifecycle. */
  store: FamiliarStore
  children?: ReactNode
}

const Context = createContext<FamiliarStore | undefined>(undefined)

/** Gives its subtree `store`. Nested providers each give their own. */
export const FamiliarProvider = ({
  store,
  children,
}: FamiliarProviderProps): ReactElement =>
  createElement(Context.Provider, { value: store }, children)

/** Uses Zustand's standard subscription and Object.is selection. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T => {
  const store = useContext(Context)
  if (!store) {
    throw new Error('useFamiliar must be used within a FamiliarProvider')
  }
  return useStore(store, selector)
}

export const useTranscript = () => useFamiliar((state) => state.transcript)
