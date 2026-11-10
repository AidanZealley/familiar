import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  type ReactElement,
} from 'react'
import { useStore } from 'zustand'
import type { RoomStore, RoomState } from './room.ts'

export type RoomProviderProps = {
  /** Caller owns the store and its connection lifecycle. */
  store: RoomStore
  children?: ReactNode
}

const Context = createContext<RoomStore | undefined>(undefined)

/**
 * Gives its subtree a room, as an embedded assistant has one. Nested
 * providers each give their own. For the workspace's and Familiars'
 * stores, use zustand's `useStore` directly.
 */
export const RoomProvider = ({
  store,
  children,
}: RoomProviderProps): ReactElement =>
  createElement(Context.Provider, { value: store }, children)

/** The nearest provider's room store, for its commands. */
export const useRoomStore = (): RoomStore => {
  const store = useContext(Context)
  if (!store) {
    throw new Error('Room hooks must be used within a RoomProvider')
  }
  return store
}

/** Uses Zustand's standard subscription and Object.is selection. */
export const useRoom = <T>(selector: (state: RoomState) => T): T =>
  useStore(useRoomStore(), selector)
