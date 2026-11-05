import type { Context, JsonValue } from '@earendil-works/chord'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import {
  defineTool as piDefineTool,
  type TaskId,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
  type ToolTaskInput,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  entriesOf,
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
  type MessageData,
  type ScheduledData,
} from './conversation/message.ts'

/**
 * Familiar's tools: Pi's tool definition, plus the person each call runs for,
 * read from the stored input that started it. Hosts' tools and core's own
 * tools that act for a person are defined with this.
 */

export { Type } from '@earendil-works/pi-ai'
export type { Static, TSchema } from '@earendil-works/pi-ai'

export type ToolDetails = JsonValue
export type ToolContext = Context
export type ToolResult<TDetails extends JsonValue = JsonValue> =
  ToolExecutionResult<TDetails>

/** Pi's tool API, plus who the call runs for. */
export type FamiliarToolApi<TDetails extends JsonValue = JsonValue> =
  ToolExecutionApi<TDetails> & {
    /**
     * The person this call runs for: the author of the message that started
     * it, or the creator of a scheduled run, read from storage, never from
     * the tool's arguments. Undefined for other work, such as memory upkeep.
     * A tool that narrows what someone
     * may do with its data or actions checks it against this.
     */
    readonly author: Author | undefined
  }

export type FamiliarTool<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> = Omit<ToolRegistration<TParameters, TDetails>, 'execute'> & {
  execute(
    args: Static<TParameters>,
    api: FamiliarToolApi<TDetails>,
    context: Context,
  ): Promise<ToolResult<TDetails>>
}

/** Pi owns execution; Familiar adds the person the call runs for. */
export function defineTool<
  TParameters extends TSchema,
  TDetails extends JsonValue = JsonValue,
>(
  tool: FamiliarTool<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails> {
  return piDefineTool({
    ...tool,
    execute: async (args, api, context) => {
      const author = await api.commit(
        (tx) => toolAuthor(tx, api.taskId),
        context,
      )
      // Inherit Pi's live getters rather than evaluating them into snapshots.
      const invocation = Object.create(api, {
        author: { value: author, enumerable: true },
      }) as FamiliarToolApi<TDetails>
      return tool.execute(args, invocation, context)
    },
  })
}

/**
 * The person a tool call runs for, resolved through its persisted call
 * ancestry, never from its arguments: a message's author, or the creator of
 * a scheduled run. Nested calls follow their parent. The assistant entry
 * bounds the search, so later queued or placed messages cannot steal it.
 * Undefined for any other input, such as memory upkeep.
 */
async function toolAuthor(tx: Tx, taskId: TaskId): Promise<Author | undefined> {
  const task = await tx.task(taskId)
  if (!task || task.kind !== 'pi.tool') {
    return undefined
  }
  const input = task.input as ToolTaskInput
  if (input.kind === 'nested') {
    return toolAuthor(tx, input.parent)
  }
  for await (const entry of entriesOf(tx, {
    conversationId: task.conversationId,
    maxEntryId: input.assistant,
  })) {
    if (entry.kind === MESSAGE_KIND) {
      return (entry.data as MessageData).author
    }
    if (entry.kind === SCHEDULED_KIND) {
      return (entry.data as ScheduledData).creator
    }
    // Other input, e.g. upkeep, has no person behind it. Compaction summaries
    // are history markers, not inputs, and must not hide the original input.
    if (
      !entry.head &&
      entry.model?.some((message) => message.role === 'user')
    ) {
      return undefined
    }
  }
  return undefined
}
