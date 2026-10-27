import type { Message } from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
  ROOT_CONVERSATION_ID,
  section,
} from '@earendil-works/pi-durable'
import { coreFacts, listFacts, Memory, type MemoryState } from './facts.ts'
import { Episodes, type EpisodesState } from './episodes.ts'
import { searchMemory } from './recall.ts'
import { memoryTools } from './tools.ts'

const render = (memory: MemoryState | undefined) => {
  const listed = memory ? listFacts(coreFacts(memory)) : ''
  return `What you remember. Use it without announcing it. Save new lasting facts with remember. When one changes, use revise_memory; when it stops being true, retire it. Use forget only when someone asks you to forget something. Use recall to search what you remember beyond this.
${listed || '(nothing yet)'}`
}

const textOf = (message: Message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n')

/** What to recall for one request, rendered once so retries can't differ. */
const recallFor = (
  memory: MemoryState,
  episodes: EpisodesState | undefined,
  query: string,
  now: number,
) => {
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
 * recalled for the latest message, and tools to keep the store.
 */
export const createMemoryExtension = (options: MemoryExtensionOptions) =>
  defineExtension({
    name: 'familiar.memory',
    tools: memoryTools,
    sections: [
      // Changes only when core does, so the provider's prompt cache holds between.
      section('memory', async (input, context) =>
        render(await input.read.snapshot(Memory, context)),
      ),
    ],
    hooks: [
      hook(GenerationTask, {
        // Recalled facts go after everything else, for this request only:
        // the prompt, the stored transcript and every earlier message stay
        // byte for byte the same, so the provider's prompt cache holds.
        beforeRequest: async ({ messages }, api, context) => {
          const latest = messages.findLast((message) => message.role === 'user')
          const memory = await api.snapshot(Memory, context)
          if (!latest || !memory) return
          // A retried request shows exactly what the first attempt showed,
          // even if memory changed in between.
          const recalled = await api.memo(
            'familiar.recall',
            recallFor(
              memory,
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
          )
            await options.recalled(recalled.facts)
          if (recalled.note === null) return
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
