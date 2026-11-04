import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  type ReactElement,
} from 'react'
import { useStore } from 'zustand'
import type { FamiliarStore, FamiliarState } from './store/types.ts'
import type { HostState, SupportedHostApi } from './store/host-api.ts'

export type FamiliarProviderProps<Api> = {
  /** Caller owns the store and its connection lifecycle. */
  store: FamiliarStore<Api>
  children?: ReactNode
}

export type FamiliarBindings<Api> = {
  FamiliarProvider: (props: FamiliarProviderProps<Api>) => ReactElement
  useFamiliar: <T>(selector: (state: HostState<Api>) => T) => T
  useTranscript: () => FamiliarState['transcript']
}

/**
 * Create once at module scope, for the host API `Api` (required), the same
 * type its stores use. Each factory owns one explicit store context.
 */
export function createFamiliarBindings<Api>(
  ..._supported: [SupportedHostApi<Api>] extends [never] ? [never] : []
): FamiliarBindings<Api> {
  void _supported
  const Context = createContext<FamiliarStore<Api> | undefined>(undefined)
  const FamiliarProvider = ({ store, children }: FamiliarProviderProps<Api>) =>
    createElement(Context.Provider, { value: store }, children)

  /** Uses Zustand's standard subscription and Object.is selection. */
  const useFamiliar = <T>(selector: (state: HostState<Api>) => T): T => {
    const store = useContext(Context)
    if (!store) {
      throw new Error('useFamiliar must be used within a FamiliarProvider')
    }
    return useStore(store, selector)
  }
  const useTranscript = () => useFamiliar((state) => state.transcript)
  return { FamiliarProvider, useFamiliar, useTranscript }
}
