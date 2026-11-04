import type { Context } from '@earendil-works/chord'
import {
  createRegistry,
  ROOT_CONVERSATION_ID,
  type Registry,
  type TaskId,
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
  type ScheduledData,
  type StoredMessageData,
} from './conversation/message.ts'
import { Upkeep } from './memory/upkeep/schedule.ts'

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

/** What a host decides on before a tool runs. */
export type ToolInvocation = {
  invoker: Invoker
  /** The tool's name, as the model calls it. */
  tool: string
  /** The installed extension that provides it, such as `familiar.plugin.web`. */
  extension: string
}

/**
 * Whether this call may run now. Asked immediately before every execution,
 * including scheduled runs, nested calls and reruns after a crash, so a
 * revoked permission applies to work already underway. Anything but `true`,
 * or a throw, refuses: the tool doesn't run and the model reads that it
 * wasn't permitted.
 */
export type AuthorizeTool = (
  call: ToolInvocation,
  context: Context,
) => boolean | Promise<boolean>

/**
 * Allows every call. Only for hosts that only their owner can reach, such as
 * the daemon on its owner's network: there everyone who can send a message
 * may run every tool.
 */
export const authorizeSingleOwner: AuthorizeTool = () => true

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

const refusal = (tool: string): ToolExecutionResult => ({
  isError: true,
  output: [
    {
      type: 'text',
      text: `Not permitted: ${tool} wasn't run for this request.`,
    },
  ],
})

/**
 * The tool as installed: resolves the invoker, asks the host, and only then
 * runs the original with the invoker on its API.
 */
const authorized = (
  tool: ToolRegistration,
  extension: string,
  authorize: AuthorizeTool,
): ToolRegistration => ({
  ...tool,
  execute: async (args, api, context) => {
    const invoker = await api.commit(
      (tx) => toolInvoker(tx, api.taskId),
      context,
    )
    let allowed = false
    try {
      allowed =
        (await authorize({ invoker, tool: tool.name, extension }, context)) ===
        true
    } catch (error) {
      // Cancellation stays cancellation; any other failure refuses.
      if (context.abortSignal?.aborted) {
        throw error
      }
    }
    if (!allowed) {
      return refusal(tool.name)
    }
    // Inherit Pi's live getters rather than evaluating them into snapshots.
    const invocation = Object.create(api, {
      invoker: { value: invoker, enumerable: true },
    }) as typeof api
    return tool.execute(args, invocation, context)
  },
})

/**
 * Familiar's only registry: Pi's own, except that every tool it installs runs
 * through `authorize`. Pi resolves the tool it executes from the registry for
 * model calls, nested calls and recovery alike, and every install (core,
 * plugins, raw Pi tools, MCP servers and their changes, tool search) comes
 * through here, so there is no other path to a tool's `execute`. Extension
 * `wraps` apply on top of the authorized tool; a wrap that replaces `execute`
 * without calling it is trusted plugin code taking that call over.
 */
export function authorizingRegistry(authorize: AuthorizeTool): Registry {
  const registry = createRegistry()
  return {
    snapshot: () => registry.snapshot(),
    subscribe: (listener) => registry.subscribe(listener),
    uninstall: (extension) => registry.uninstall(extension),
    install: (extension) =>
      registry.install({
        ...extension,
        tools: extension.tools?.map((tool) =>
          authorized(tool, extension.name, authorize),
        ),
      }),
  }
}
