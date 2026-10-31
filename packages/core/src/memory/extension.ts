import type { Message } from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
  ROOT_CONVERSATION_ID,
  section,
} from '@earendil-works/pi-durable'
import { textOf } from '../conversation/message.ts'
import { coreFacts, Facts, listFacts, type FactsState } from './facts.ts'
import type { RecallNote } from './recall.ts'
import type { TranscriptExchanges } from './exchanges.ts'
import type { SearchTimes } from './health.ts'
import { createMemoryTools } from './tools.ts'

const render = (facts: FactsState | undefined) => {
  const listed = facts ? listFacts(coreFacts(facts)) : ''
  return `What you remember, filed from your conversations each night. Use it without announcing it. You can't save facts yourself: when someone asks you to remember something, say you will. It is filed tonight, and until then recall still finds what was said. Use recall to search what you remember beyond this, including earlier conversations, and read_memory to open what it finds.
${listed || '(nothing yet)'}`
}

export type MemoryExtensionOptions = {
  /** Records that facts reached the model. Hooks can't commit, so the owner of the Harness does. */
  recalled: (ids: string[]) => Promise<void>
  /** The exchange index the tools search. */
  exchanges: TranscriptExchanges
  /**
   * Automatic recall's note for `query`, read in one transaction so upkeep
   * can't file something between reads and leave it in neither. `unfiled`
   * adds exchanges compacted out of the view that upkeep hasn't filed.
   * Hooks can't read the transcript, so the owner of the Harness does.
   */
  recall: (query: string, unfiled: boolean) => Promise<RecallNote>
  /** Where every search's time is recorded, for health. */
  times: SearchTimes
  /** The IANA zone the tools read dates in. */
  timeZone: string
}

/**
 * Long-term memory: core facts the model sees on every request, facts
 * recalled for the latest message, and the tools to search them. Nightly
 * upkeep writes them.
 */
export const createMemoryExtension = (options: MemoryExtensionOptions) =>
  defineExtension({
    name: 'familiar.memory',
    tools: createMemoryTools(
      options.exchanges,
      options.times,
      options.timeZone,
    ),
    sections: [
      // Changes only when core does, so the provider's prompt cache holds between.
      section('memory', async (input, context) =>
        render(await input.read.snapshot(Facts, context)),
      ),
    ],
    hooks: [
      hook(GenerationTask, {
        // Recalled facts go after everything else, for this request only:
        // the prompt, the stored transcript and every earlier message stay
        // byte for byte the same, so the provider's prompt cache holds.
        beforeRequest: async ({ messages }, api, context) => {
          const latest = messages.findLast((message) => message.role === 'user')

          if (!latest) {
            return
          }

          // Searched once per run and memoised, so a retried or follow-up
          // request shows exactly what the first one did, even if memory has
          // changed since.
          let recalled = await api.memo<RecallNote>('familiar.recall', context)

          if (!recalled) {
            recalled = await api.memo(
              'familiar.recall',
              await options.recall(
                textOf(latest),
                // Only the main conversation's own past: upkeep's passes
                // review a batch and must not be shown other messages.
                api.conversationId === ROOT_CONVERSATION_ID,
              ),
              context,
            )

            // Only conversation counts as use; upkeep's recall is housekeeping.
            // Recorded even when nothing is shown: core facts the message
            // matched were used too.
            if (
              recalled.facts.length &&
              api.conversationId === ROOT_CONVERSATION_ID
            ) {
              await options.recalled(recalled.facts)
            }
          }

          if (recalled.note === null) {
            return
          }

          const note: Message = {
            role: 'user',
            content: recalled.note,
            timestamp: messages.at(-1)!.timestamp,
          }

          return { messages: [...messages, note] }
        },
      }),
    ],
  })
