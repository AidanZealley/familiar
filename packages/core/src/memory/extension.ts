import type { Message } from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
  section,
  type TaskId,
} from '@earendil-works/pi-durable'
import { textOf } from '../conversation/message.ts'
import { coreFacts, Facts, listFacts, type FactsState } from './facts.ts'
import type { RecallNote } from './recall.ts'
import type { ExchangesOf } from './exchanges.ts'
import { createMemoryTools } from './tools.ts'
import {
  familiarOf,
  readFamiliarDoc,
  type FamiliarId,
} from '../workspace/familiars.ts'

/** The memory prompt section for these facts. */
export const renderMemorySection = (facts: FactsState | undefined) => {
  const listed = facts ? listFacts(coreFacts(facts)) : ''
  return `What you remember, filed from your conversations each night. Use it without announcing it. You can't save facts yourself: when someone asks you to remember something, say you will. It is filed tonight, and until then recall still finds what was said. Use recall to search what you remember beyond this, including earlier conversations, and read_memory to open what it finds.
${listed || '(nothing yet)'}`
}

export type MemoryExtensionOptions = {
  /** Records that facts reached the model. Hooks can't commit, so the owner of the Harness does. */
  recalled: (familiar: FamiliarId, ids: string[]) => Promise<void>
  /** Each Familiar's exchange index, which the tools search. */
  exchangesOf: ExchangesOf
  /**
   * Automatic recall's note for the input `request` answers, read in one
   * transaction so upkeep can't file something between reads and leave it in
   * neither. `query` is the model's copy of that input, searched when no
   * person sent it. `unfiled` adds exchanges compacted out of the view that
   * upkeep hasn't filed. Hooks can't read the transcript, so the owner of
   * the Harness does.
   */
  recall: (
    familiar: FamiliarId,
    query: string,
    request: TaskId,
    unfiled: boolean,
  ) => Promise<RecallNote>
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
    tools: createMemoryTools(options.exchangesOf, options.timeZone),
    sections: [
      // Changes only when core does, so the provider's prompt cache holds between.
      section('memory', async (input, context) => {
        const familiar = await familiarOf(
          input.read,
          input.conversationId,
          context,
        )
        return (
          familiar &&
          renderMemorySection(
            await readFamiliarDoc(input.read, Facts, familiar, context),
          )
        )
      }),
    ],
    hooks: [
      hook(GenerationTask, {
        // Recalled facts go after everything else, for this request only:
        // the prompt, the stored transcript and every earlier message stay
        // byte for byte the same, so the provider's prompt cache holds.
        beforeRequest: async ({ messages }, api, context) => {
          const latest = messages.findLast((message) => message.role === 'user')
          const familiar = await familiarOf(api, api.conversationId, context)

          if (!latest || familiar === undefined) {
            return
          }
          // A Familiar's chat is the conversation its ID names; the others
          // are upkeep's.
          const chat = api.conversationId === familiar

          // Searched once per run and memoised, so a retried or follow-up
          // request shows exactly what the first one did, even if memory has
          // changed since.
          let recalled = await api.memo<RecallNote>('familiar.recall', context)

          if (!recalled) {
            recalled = await api.memo(
              'familiar.recall',
              await options.recall(
                familiar,
                textOf(latest),
                api.taskId,
                // Only the chat's own past: upkeep's passes review a batch
                // and must not be shown other messages.
                chat,
              ),
              context,
            )

            // Only conversation counts as use; upkeep's recall is housekeeping.
            // Recorded even when nothing is shown: core facts the message
            // matched were used too.
            if (recalled.facts.length && chat) {
              await options.recalled(familiar, recalled.facts)
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
