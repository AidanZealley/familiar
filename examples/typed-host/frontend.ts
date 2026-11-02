import { createElement } from 'react'
import { createFamiliarStore, type FamiliarStore } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { HostApi } from './api.ts'

export const connect = (url: string, fetch: typeof globalThis.fetch) =>
  createFamiliarStore<HostApi>(url, { fetch })

export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()

const Conversation = () => {
  const send = useFamiliar((state) => state.conversation.send)
  const transcript = useTranscript()
  return createElement(
    'button',
    { onClick: () => void send('Hello') },
    `Send a message, ${transcript?.items.length ?? 0} transcript items`,
  )
}

export const Example = ({ store }: { store: FamiliarStore<HostApi> }) =>
  createElement(FamiliarProvider, { store }, createElement(Conversation))
