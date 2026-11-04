// Compile assertions only. These functions are never executed.
import type {
  HostApi,
  ParticipantApi,
  ErasedOutputApi,
  PartialApi,
  NonstandardApi,
  IncompatibleApi,
  WidenedApi,
  NarrowInputApi,
  PartialConversationApi,
} from './api.ts'
import {
  createFamiliarStore,
  type FamiliarStore,
  type HttpApi,
} from '@familiar-ai/client'

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
  // @ts-expect-error erased endpoint output cannot prove the response contract
  createFamiliarStore<ErasedOutputApi>('/api')
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
  const participant = createFamiliarStore<ParticipantApi>('/api')
  participant.getState().conversation.send('Hello')
  participant.getState().conversation.loadOlder()
  participant.getState().memory.health()
  // Commands narrow per operation: health without the memory edits.
  // @ts-expect-error revise isn't selected
  participant.getState().memory.revise('fact', 'Changed')
  // @ts-expect-error no model routes are selected
  participant.getState().conversation.setModel({ provider: 'p', modelId: 'm' })
  // @ts-expect-error no MCP routes are selected
  participant.getState().mcp.add({})
  const partial = createFamiliarStore<PartialApi>('/api')
  partial.getState().conversation.send('Hello')
  partial.getState().memory.health()
  // @ts-expect-error a hand-composed health route grants only health
  partial.getState().memory.setPinned('fact', true)
  // @ts-expect-error widened host declarations lose guarantees
  createFamiliarStore<WidenedApi>('/api')
  // @ts-expect-error erased host declarations cannot grant commands
  createFamiliarStore<ReturnType<typeof JSON.parse>>('/api')
  const messagesOnly = createFamiliarStore<PartialConversationApi>('/api')
  messagesOnly.getState().conversation.send('Hello')
  // @ts-expect-error no abort endpoint
  messagesOnly.getState().conversation.abort()
  // @ts-expect-error no history endpoint
  messagesOnly.getState().conversation.loadOlder()
  const full = createFamiliarStore<HttpApi>('/api')
  full.getState().mcp.reconnect('notes')
  // @ts-expect-error the host's API type is required
  createFamiliarStore('/api')
  // @ts-expect-error distinct APIs cannot be substituted
  const incompatible: FamiliarStore<HttpApi> = store
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
  const fullStore = createFamiliarStore<HttpApi>('/api')
  // @ts-expect-error provider rejects another host's store, even with extra commands
  createElement(FamiliarProvider, { store: fullStore })
  return createElement(
    'span',
    null,
    transcript?.items.length,
    typeof send,
    count,
  )
}

export const checkBindingValidation = () => {
  // @ts-expect-error the host's API type is required
  createFamiliarBindings()
  // @ts-expect-error arbitrary API type is rejected by bindings too
  createFamiliarBindings<string>()
  // @ts-expect-error erased API type is rejected by bindings too
  createFamiliarBindings<ReturnType<typeof JSON.parse>>()
}

export const checkErasedOutputBindings = () => {
  // @ts-expect-error bindings reject erased endpoint outputs too
  createFamiliarBindings<ErasedOutputApi>()
}
