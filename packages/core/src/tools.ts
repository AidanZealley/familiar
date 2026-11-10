import type { Context, ContextKey, JsonValue } from '@earendil-works/chord'
import { withContextValue } from '@earendil-works/chord/context'
import type { TSchema } from '@earendil-works/pi-ai'
import type {
  EntryRecord,
  TaskId,
  ToolExecutionResult,
  ToolRegistration,
  ToolTaskInput,
  Tx,
} from '@earendil-works/pi-durable'
import type { PluginFetch } from './connections/index.ts'
import {
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
  type MessageData,
  type ScheduledData,
} from './conversation/message.ts'
import type { Notification } from './notify.ts'
import { entriesOf } from './pi/entries.ts'

/**
 * Familiar's tools are plain Pi tools. What Familiar adds reaches each call
 * through Pi's context, where `familiar(context)` reads it.
 */

export { defineTool } from '@earendil-works/pi-durable'
export { Type } from '@earendil-works/pi-ai'
export type { Static, TSchema } from '@earendil-works/pi-ai'

export type ToolDetails = JsonValue
export type ToolContext = Context
export type ToolResult<TDetails extends JsonValue = JsonValue> =
  ToolExecutionResult<TDetails>

/** What Familiar gives each tool call. */
export type ToolServices = {
  /** The owner's IANA time zone. Write times with `localMinute`. */
  timeZone: string
  notify(notification: Notification): Promise<void>
  /** The host's network access. On Node it refuses private addresses. */
  fetch: PluginFetch
  /**
   * `fetch`, with the named secret attached, only if the request matches what
   * the plugin declared for it; otherwise throws without sending. The tool
   * never sees the value. Throws a message the model reads as "not
   * connected" when it isn't set. Redirects come back unfollowed.
   */
  authorizedFetch(
    secret: string,
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>
  /**
   * The person this call runs for: the author of the message that started
   * it, or the creator of a scheduled run, read from storage, never from the
   * tool's arguments. Undefined for other work, such as memory upkeep. A
   * tool that narrows what someone may do checks it against this.
   */
  author(): Promise<Author | undefined>
}

// A global symbol, so a plugin's own copy of core finds the same services.
const servicesKey: ContextKey<ToolServices> = {
  token: Symbol.for('familiar.toolServices'),
}

/** The services for the call `context` belongs to. */
export function familiar(context: Context): ToolServices {
  const services = context.value(servicesKey)
  if (!services) {
    throw new Error('This tool needs a Familiar to run it.')
  }
  return services
}

/** `tool`, given `services` and its call's author whenever it runs. */
export function withServices<P extends TSchema, D extends JsonValue>(
  tool: ToolRegistration<P, D>,
  services: Omit<ToolServices, 'author'>,
): ToolRegistration<P, D> {
  return {
    ...tool,
    execute: (args, api, context) =>
      tool.execute(
        args,
        api,
        withContextValue(
          servicesKey,
          {
            ...services,
            author: () =>
              api.commit((tx) => toolAuthor(tx, api.taskId), context),
          },
          context,
        ),
      ),
  }
}

/**
 * The person a tool call runs for, resolved through its persisted call
 * ancestry, never from its arguments: a message's author, or the creator of
 * a scheduled run. Undefined for any other input, such as memory upkeep.
 */
async function toolAuthor(tx: Tx, taskId: TaskId): Promise<Author | undefined> {
  const input = await callInput(tx, taskId)
  return input?.kind === MESSAGE_KIND
    ? (input.data as MessageData).author
    : input?.kind === SCHEDULED_KIND
      ? (input.data as ScheduledData).creator
      : undefined
}

/**
 * The input a tool call's run answers: a person's message or a scheduled
 * prompt, whose data says who it's for and which room it came from.
 * Nested calls follow their parent. The assistant entry bounds the search,
 * so later queued or placed messages cannot steal it. Undefined for any
 * other input, such as memory upkeep.
 */
export async function callInput(
  tx: Tx,
  taskId: TaskId,
): Promise<EntryRecord | undefined> {
  const task = await tx.task(taskId)
  if (!task || task.kind !== 'pi.tool') {
    return undefined
  }
  const input = task.input as ToolTaskInput
  if (input.kind === 'nested') {
    return callInput(tx, input.parent)
  }
  for await (const entry of entriesOf(tx, {
    conversationId: task.conversationId,
    maxEntryId: input.assistant,
  })) {
    if (entry.kind === MESSAGE_KIND || entry.kind === SCHEDULED_KIND) {
      return entry
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
