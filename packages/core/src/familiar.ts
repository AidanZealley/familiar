import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  type ConversationWatch,
  type Extension,
  type ModelRef,
  type Storage,
} from '@earendil-works/pi-durable'
import { createPersona } from './persona.ts'

export type FamiliarOptions = {
  /** Where everything Familiar knows is kept. One host process owns it at a time. */
  storage: Storage
  /** The host's model collection, with its providers and credentials configured. */
  models: Models
  model: ModelRef
  /** What the assistant calls itself. */
  name?: string
  /** Host-specific tools and behaviour, installed after Familiar's own. */
  extensions?: Extension[]
}

/** One message from a person. Hosts authenticate; Familiar only records who spoke. */
export type Message = {
  author: string
  text: string
  /** Stable per logical message, so a retried send is admitted once. */
  requestId: string
}

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

export type MessageData = { author: string; text: string }

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = {
  send(message: Message): Promise<void>
  /** Stop the current run. Queued messages stay queued. */
  abort(): Promise<void>
  /** The conversation's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  close(): Promise<void>
}

const context = BACKGROUND_CONTEXT

export async function openFamiliar(
  options: FamiliarOptions,
): Promise<Familiar> {
  const registry = createRegistry()
  registry.install(createPersona(options.name ?? 'Familiar'))
  for (const extension of options.extensions ?? []) registry.install(extension)

  const harness = await Harness.open(
    options.storage,
    { models: options.models, registry },
    context,
  )
  const conversation = await harness.root(context, {
    agent: { model: options.model },
  })
  // A configured model wins over the one the conversation was created with.
  await conversation.configure({ model: options.model }, context)
  harness.resume() // finish whatever the last process left unfinished

  return {
    async send({ author, text, requestId }) {
      await conversation.submit(
        {
          type: 'input',
          content: text,
          requestId,
          entry: { kind: MESSAGE_KIND, data: { author, text } },
        },
        context,
      )
    },
    async abort() {
      await conversation.abort(context)
    },
    watch: () => conversation.watch(context),
    close: () => harness.close(context),
  }
}
