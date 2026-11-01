import { createElement } from 'react'
import { FamiliarContext } from '../../context.ts'
import type { FamiliarProviderProps } from './types.ts'

/** Supplies a store without taking ownership of its connection. */
export const FamiliarProvider = ({ store, children }: FamiliarProviderProps) =>
  createElement(FamiliarContext.Provider, { value: store }, children)
