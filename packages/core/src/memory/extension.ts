import type { Message } from '@earendil-works/pi-ai'
import {
  defineExtension,
  GenerationTask,
  hook,
  section,
  type TaskId,
} from '@earendil-works/pi-durable'
import { textOf } from '../conversation/message.ts'
import { familiarOf, type FamiliarId } from '../workspace/familiars.ts'
import { renderSection } from './section.ts'
import { createMemoryTools } from './tools.ts'
import type { ViewOf } from './view.ts'

export type MemoryExtensionOptions = {
  viewOf: ViewOf
  /**
   * Automatic recall's note for the input `request` answers, or null.
   * `query` is the model's copy of that input. Hooks can't read the
   * transcript, so the owner of the Harness does.
   */
  recall: (
    familiar: FamiliarId,
    query: string,
    request: TaskId,
  ) => Promise<string | null>
  /** The IANA zone dates are read and shown in. */
  timeZone: string
}

/**
 * Memory in the chat: the prompt section it always sees, evidence recalled
 * for the latest message, and the tools to search and open memory.
 */
export const createMemoryExtension = (options: MemoryExtensionOptions) =>
  defineExtension({
    name: 'familiar.memory',
    tools: createMemoryTools(options.viewOf, options.timeZone),
    sections: [
      section('memory', async (input, context) => {
        const familiar = await familiarOf(
          input.read,
          input.conversationId,
          context,
        )
        if (familiar === undefined) {
          return undefined
        }
        const view = options.viewOf(familiar)
        await view.ready()
        return renderSection(view)
      }),
    ],
    hooks: [
      hook(GenerationTask, {
        // Recalled evidence goes after everything else, for this request
        // only, so the prompt and every earlier message stay byte for byte
        // the same and the provider's prompt cache holds.
        beforeRequest: async ({ messages }, api, context) => {
          const latest = messages.findLast((message) => message.role === 'user')
          const familiar = await familiarOf(api, api.conversationId, context)
          // Only the Familiar's chat: memory's own calls are never shown more.
          if (!latest || familiar !== api.conversationId) {
            return
          }
          // Searched once per run and memoised, so a retried or follow-up
          // request shows exactly what the first one did.
          let recalled = await api.memo<{ note: string | null }>(
            'familiar.recall',
            context,
          )
          recalled ??= await api.memo(
            'familiar.recall',
            {
              note: await options.recall(familiar, textOf(latest), api.taskId),
            },
            context,
          )
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
