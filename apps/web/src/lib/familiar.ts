import { createFamiliarStore, type FamiliarState } from '@familiar-ai/client'
import { useStore } from 'zustand'

/**
 * The app's one connection, open for its lifetime. Call commands on it
 * directly, such as `familiar.conversation.send(text)`.
 */
export const familiar = createFamiliarStore('/api')

/** Selects from the store's state, re-rendering when the selection changes. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T =>
  useStore(familiar, selector)
