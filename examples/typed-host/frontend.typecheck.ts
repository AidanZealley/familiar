// Compile assertions only. These functions are never executed.
import type {
  HostApi,
  PartialApi,
  NonstandardApi,
  IncompatibleApi,
  WidenedApi,
  NarrowInputApi,
  PartialConversationApi,
} from './api.ts'
import { createFamiliarStore, type FamiliarStore } from '@familiar-ai/client'

export const checkHost = (store: FamiliarStore<HostApi>) => {
  const state = store.getState()
  state.conversation.send('Hello')
  state.conversation.abort()
  state.conversation.loadOlder()
  state.memory.revise('fact', 'Corrected')
  state.memory.setPinned('fact', true)
  state.memory.health()
  // @ts-expect-error no MCP routes
  state.mcp.add({})
  // @ts-expect-error no model routes
  state.conversation.setModel({ provider: 'test', modelId: 'test' })
  // @ts-expect-error exact arguments retained
  state.conversation.send(1)
  // @ts-expect-error optional streamed data remains optional
  void state.memory.facts.facts
  // @ts-expect-error no schedules route
  state.schedules.cancel('id')
  // @ts-expect-error read-only store
  store.setState({})
}

export const createChecked = () => {
  const store = createFamiliarStore<HostApi>('/api')
  checkHost(store)
  // @ts-expect-error rejects arbitrary non-API types
  createFamiliarStore<string>('/api')
  // @ts-expect-error rejects unknown rather than granting full commands
  createFamiliarStore<unknown>('/api')
  // @ts-expect-error nonstandard paths do not describe a supported API
  createFamiliarStore<NonstandardApi>('/api')
  // @ts-expect-error standard paths with incompatible handlers are rejected
  createFamiliarStore<IncompatibleApi>('/api')
  // @ts-expect-error host cannot require inputs the client does not send
  createFamiliarStore<NarrowInputApi>('/api')
  const partial = createFamiliarStore<PartialApi>('/api')
  partial.getState().conversation.send('Hello')
  // @ts-expect-error partial memory group exposes no memory commands
  partial.getState().memory.health()
  // @ts-expect-error widened host declarations lose guarantees
  createFamiliarStore<WidenedApi>('/api')
  // @ts-expect-error erased host declarations cannot grant commands
  createFamiliarStore<ReturnType<typeof JSON.parse>>('/api')
  const messagesOnly = createFamiliarStore<PartialConversationApi>('/api')
  // @ts-expect-error partial conversation exposes no command group
  messagesOnly.getState().conversation.send('Hello')
  // @ts-expect-error no history endpoint
  messagesOnly.getState().conversation.loadOlder()
  const full = createFamiliarStore('/api')
  full.getState().mcp.reconnect('notes')
  // @ts-expect-error distinct APIs cannot be substituted
  const incompatible: FamiliarStore = store
  return { store, full, incompatible }
}

import { createElement } from 'react'
import { createFamiliarBindings } from '@familiar-ai/client/react'

export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()
export const checkBindings = () => {
  const send = useFamiliar((state) => state.conversation.send)
  const transcript = useTranscript()
  // @ts-expect-error typed selector cannot access omitted MCP
  useFamiliar((state) => state.mcp)
  // @ts-expect-error selector return type stays precise
  const count: number = useFamiliar((state) => state.connection)
  // @ts-expect-error provider rejects another host's store, even with extra commands
  createElement(FamiliarProvider, { store: createFamiliarStore('/api') })
  return createElement(
    'span',
    null,
    transcript?.items.length,
    typeof send,
    count,
  )
}

export const checkBindingValidation = () => {
  // @ts-expect-error arbitrary API type is rejected by bindings too
  createFamiliarBindings<string>()
  // @ts-expect-error erased API type is rejected by bindings too
  createFamiliarBindings<ReturnType<typeof JSON.parse>>()
}
