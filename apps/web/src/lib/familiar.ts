import { createFamiliarStore, type FamiliarState } from '@familiar-ai/client'
import { useStore } from 'zustand'

/** The app's one connection to the daemon, opened on first import. */
export const familiar = createFamiliarStore('/api')

export const useFamiliar = <T>(selector: (state: FamiliarState) => T) =>
  useStore(familiar, selector)
