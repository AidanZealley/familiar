import type { ReactNode } from 'react'
import type { FamiliarStore } from '../../store.ts'

export type FamiliarProviderProps = {
  /** Read/subscribable store, owned by the caller. The provider never disconnects it. */
  store: FamiliarStore
  children?: ReactNode
}
