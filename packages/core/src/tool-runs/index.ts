import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type {
  Harness,
  JsonObject,
  RegistrySnapshot,
  ToolExecutionResult,
} from '@earendil-works/pi-durable'
import type { Author } from '../conversation/message.ts'
import type { McpInvocation } from '../mcp/background.ts'
import type { ToolRunData } from '../rooms/log.ts'
import { closedTo, membersOf, Rooms, type RoomId } from '../rooms/rooms.ts'
import type { FamiliarCapabilities } from '../workspace/capabilities.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import {
  argsProblem,
  connectionToolsOf,
  failureOf,
  textOf,
  type ConnectionTool,
} from './tools.ts'

export { argsProblem, type ConnectionTool } from './tools.ts'

/**
 * What became of a person's run. `ask`: the owner wants this tool approved
 * first, so nothing ran; run it again with `approved` once the person has
 * seen it. `unavailable`: the Familiar can't run it from here now (not in
 * the room, the tool or its connection is gone or off, or the args no
 * longer fit), so nothing ran. `message` is the tool's own text.
 */
export type ToolRun =
  | { outcome: 'done' }
  | { outcome: 'failed'; message?: string }
  | { outcome: 'ask' }
  | { outcome: 'unavailable' }

/** What a read returned: the tool's text, or why nothing ran or it failed. */
export type ToolRead =
  | { outcome: 'read'; text: string }
  | { outcome: 'failed'; message?: string }
  /** Not runnable here now, not read-only, or set to ask first. */
  | { outcome: 'unavailable' }

/** A tool a person runs for `familiar` in `room`. */
export type ToolRunRequest = {
  familiar: FamiliarId
  room: RoomId
  tool: string
  args: JsonObject
}

/**
 * Running a Familiar's connection tools for a person, with no model, such
 * as from a card's control. Each runs once, now, outside Pi (no task, no
 * replay), checked against what the Familiar has at that moment.
 */
export type ToolRunsApi = {
  /**
   * Runs `tool` and records it in the room. A tool the owner wants
   * approved answers `ask` until `approved` says the person saw this call.
   */
  run(
    request: ToolRunRequest & {
      /** Who ran it, from the host, never a request body. */
      author: Author
      approved?: boolean
      /** Unique per run: the room records each once. */
      requestId: string
    },
  ): Promise<ToolRun>
  /**
   * Runs a read-only tool (`readOnlyHint: true`, not set to ask) and
   * returns its text. Never asks, never recorded.
   */
  read(request: ToolRunRequest): Promise<ToolRead>
  /** `familiar`'s connection tools as it has them now. */
  list(familiar: FamiliarId): Promise<ConnectionTool[]>
}

/** Tool runs for every Familiar; every check reads the tools' owners now. */
export function createToolRuns(
  harness: Harness,
  options: {
    registry: () => RegistrySnapshot
    capabilities: (familiar: FamiliarId) => Promise<FamiliarCapabilities>
    /** Calls an MCP tool directly, once. */
    invoke(input: McpInvocation): Promise<ToolExecutionResult>
    /** Records a run in its room. */
    record(room: RoomId, data: ToolRunData): Promise<unknown>
    now: () => number
  },
): ToolRunsApi {
  const tools = connectionToolsOf(harness, options)

  /** `tool` for `familiar` in `room`, if it can run there now with `args`. */
  const runnable = async ({ familiar, room, tool, args }: ToolRunRequest) => {
    const here = await harness.commit(async (tx) => {
      const record = (await tx.doc(Rooms)).rooms[room]
      return (
        !!record &&
        membersOf(record).includes(familiar) &&
        !(await closedTo(tx, record))
      )
    }, BACKGROUND_CONTEXT)
    const found = here ? await tools.resolve(familiar, tool) : undefined
    return found && !argsProblem(found, args) ? found : undefined
  }

  const invoke = (
    found: NonNullable<Awaited<ReturnType<typeof runnable>>>,
    { familiar, tool, args }: ToolRunRequest,
    callId: string,
  ) =>
    options.invoke({
      server: found.server,
      name: found.own,
      tool,
      args,
      familiar,
      callId,
    })

  return {
    list: tools.list,
    run: async ({ author, approved, requestId, ...request }) => {
      const found = await runnable(request)
      if (!found) {
        return { outcome: 'unavailable' }
      }
      if (found.askBeforeRunning && !approved) {
        return { outcome: 'ask' }
      }
      let failure: { message?: string } | undefined
      try {
        failure = failureOf(await invoke(found, request, `person:${requestId}`))
      } catch (error) {
        failure = { ...(error instanceof Error && { message: error.message }) }
      }
      await options.record(request.room, {
        familiar: request.familiar,
        author,
        tool: request.tool,
        args: request.args,
        outcome: failure ? 'failed' : 'done',
        ...(failure?.message !== undefined && { message: failure.message }),
        at: options.now(),
        requestId,
      })
      return failure ? { outcome: 'failed', ...failure } : { outcome: 'done' }
    },
    read: async (request) => {
      const found = await runnable(request)
      if (
        !found ||
        found.annotations?.readOnlyHint !== true ||
        found.askBeforeRunning
      ) {
        return { outcome: 'unavailable' }
      }
      try {
        const result = await invoke(
          found,
          request,
          `read:${crypto.randomUUID()}`,
        )
        const failure = failureOf(result)
        return failure
          ? { outcome: 'failed', ...failure }
          : { outcome: 'read', text: textOf(result) }
      } catch (error) {
        return {
          outcome: 'failed',
          ...(error instanceof Error && { message: error.message }),
        }
      }
    },
  }
}
