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
import { Episodes, type EpisodesState } from './episodes.ts'
import { searchMemory } from './recall.ts'
import { memoryTools } from './tools.ts'

const render = (facts: FactsState | undefined) => {
  const listed = facts ? listFacts(coreFacts(facts)) : ''
  return `What you remember, filed from your conversations each night. Use it without announcing it. You can't save facts yourself: when someone asks you to remember something, say you will, and it is filed tonight. Use recall to search what you remember beyond this, including earlier conversations.
${listed || '(nothing yet)'}`
}

type RecallMemo = {
  /** Facts the message used, to record as recalled. */
  facts: string[]
  /** What the model is shown, or null when nothing matched. */
  note: string | null
}

const recallFor = (
  memory: FactsState,
  episodes: EpisodesState | undefined,
  query: string,
  now: number,
): RecallMemo => {
  const { found, used } = searchMemory(memory, episodes, query, now)
  return {
    facts: used,
    note: found.length
      ? `Recalled from memory for the latest message; use it only if relevant:\n${found.map(({ line }) => line).join('\n')}`
      : null,
  }
}

export type MemoryExtensionOptions = {
  /** Familiar's clock. */
  now: () => number
  /** Records that facts reached the model. Hooks can't commit, so the owner of the Harness does. */
  recalled: (ids: string[]) => Promise<void>
}

/**
 * Long-term memory: core facts the model sees on every request, facts
 * recalled for the latest message, and the tools to search them. Nightly
 * upkeep writes them.
 */
export const createMemoryExtension = (options: MemoryExtensionOptions) =>
  defineExtension({
    name: 'familiar.memory',
    tools: memoryTools,
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
          const facts = await api.snapshot(Facts, context)

          if (!latest || !facts) {
            return
          }

          // Searched once per run and memoised, so a retried or follow-up
          // request shows exactly what the first one did, even if memory has
          // changed since.
          let recalled = await api.memo<RecallMemo>('familiar.recall', context)

          if (!recalled) {
            recalled = await api.memo(
              'familiar.recall',
              recallFor(
                facts,
                await api.snapshot(Episodes, context),
                textOf(latest),
                options.now(),
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
