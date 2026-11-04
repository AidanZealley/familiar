import type { TaskId, ToolTaskInput, Tx } from '@earendil-works/pi-durable'
import {
  entriesOf,
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
  type ScheduledData,
  type MessageData,
} from '../conversation/message.ts'

/**
 * The person a tool call runs for, resolved through its persisted call
 * ancestry, never from its arguments: a message's author, or the creator of
 * a scheduled run. Nested calls follow their parent. The assistant entry
 * bounds the search, so later queued or placed messages cannot steal it.
 * Undefined for any other input, such as memory upkeep.
 */
export async function toolAuthor(
  tx: Tx,
  taskId: TaskId,
): Promise<Author | undefined> {
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
