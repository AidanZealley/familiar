import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  type ConversationWatch,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  type ModelRef,
  type Registry,
} from '@earendil-works/pi-durable'
import { createHistoryExtension } from './history.ts'
import { MESSAGE_KIND } from './message.ts'

/** One message from a person. Hosts authenticate; Familiar only records who spoke. */
export type Message = {
  author: string
  text: string
  /** Stable per logical message, so a retried send is admitted once. */
  requestId: string
}

export type HistoryPage = { entries: EntryRecord[]; more: boolean }

export type ConversationApi = {
  send(message: Message): Promise<void>
  /** Stop the current run and withdraw the messages queued behind it. */
  abort(): Promise<void>
  /** Resolves once nothing is running: every sent message is answered. */
  idle(): Promise<void>
  /** The conversation's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /**
   * Up to `limit` committed entries older than entry `before`, newest first,
   * including those compaction took out of the view. `more` says whether
   * older ones exist.
   */
  history(before: EntryId, limit: number): Promise<HistoryPage>
}

const context = BACKGROUND_CONTEXT

export async function installConversation(
  harness: Harness,
  registry: Registry,
  model: ModelRef,
): Promise<ConversationApi> {
  const conversation = await harness.root(context, { agent: { model } })
  // A configured model wins over the one the conversation was created with.
  await conversation.configure({ model }, context)
  // Needs the conversation, so it joins once that exists, before any work runs.
  registry.install(createHistoryExtension(conversation))
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
    idle: () => conversation.waitForIdle(context),
    watch: () => conversation.watch(context),
    async history(before, limit) {
      // Entry IDs are ascending integers, and the bound is inclusive.
      const query = { maxEntryId: (before - 1) as EntryId }
      const entries: EntryRecord[] = []
      let cursor: Cursor | undefined
      // One past the limit tells whether more exist.
      do {
        const page = await conversation.entries(
          query,
          limit + 1 - entries.length,
          cursor,
          context,
        )
        entries.push(...page.items)
        cursor = page.next
      } while (cursor && entries.length <= limit)
      return { entries: entries.slice(0, limit), more: entries.length > limit }
    },
  }
}
