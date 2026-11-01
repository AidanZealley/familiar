import { createContext } from 'react'
import type { FamiliarStore } from './store.ts'

export const FamiliarContext = createContext<FamiliarStore | undefined>(
  undefined,
)
