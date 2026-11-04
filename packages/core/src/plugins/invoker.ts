import {
  ROOT_CONVERSATION_ID,
  type TaskId,
  type ToolTaskInput,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  entriesOf,
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
  type ScheduledData,
  type StoredMessageData,
} from '../conversation/message.ts'
import { Upkeep } from '../memory/upkeep/schedule.ts'

/**
 * Who a tool call runs for, resolved from the stored input that started it,
 * never from its arguments. Nested calls run for their caller's invoker.
 */
export type Invoker =
  /** A person's message started it. */
  | { kind: 'person'; author: Author }
  /** A schedule fell due; `author` is the person who created it. */
  | { kind: 'schedule'; author: Author; scheduleId: string }
  /** Familiar's own memory upkeep. */
  | { kind: 'system' }
  /**
   * No person can be established: a message stored with only a name, a
   * schedule with no recorded creator, or any other input.
   */
  | { kind: 'unknown' }

/**
 * Resolve a tool call's invoker through its persisted call ancestry. The
 * assistant entry bounds the search, so later queued or placed messages
 * cannot steal it. Nested calls follow their parent.
 */
export async function toolInvoker(tx: Tx, taskId: TaskId): Promise<Invoker> {
  const unknown = { kind: 'unknown' } as const
  const task = await tx.task(taskId)
  if (!task || task.kind !== 'pi.tool') {
    return unknown
  }
  const input = task.input as ToolTaskInput
  if (input.kind === 'nested') {
    return toolInvoker(tx, input.parent)
  }
  if (
    task.conversationId !== ROOT_CONVERSATION_ID &&
    task.conversationId === (await tx.doc(Upkeep)).conversation
  ) {
    return { kind: 'system' }
  }
  for await (const entry of entriesOf(tx, {
    conversationId: task.conversationId,
    maxEntryId: input.assistant,
  })) {
    if (entry.kind === MESSAGE_KIND) {
      const { author } = entry.data as StoredMessageData
      // A historical name cannot establish a person's stable identity.
      return typeof author === 'string' ? unknown : { kind: 'person', author }
    }
    if (entry.kind === SCHEDULED_KIND) {
      const { creator, scheduleId } = entry.data as ScheduledData
      return creator
        ? { kind: 'schedule', author: creator, scheduleId }
        : unknown
    }
    // Compaction summaries are history markers, not inputs, and must not
    // hide the original input.
    if (
      !entry.head &&
      entry.model?.some((message) => message.role === 'user')
    ) {
      return unknown
    }
  }
  return unknown
}
