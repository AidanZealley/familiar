import {
  BACKGROUND_CONTEXT,
  type Context,
  withAbortSignal,
} from '@earendil-works/chord/context'
import type {
  Extension,
  JsonObject,
  Registry,
} from '@earendil-works/pi-durable'
import { createToolSearchTool } from '@earendil-works/pi-durable/tool-search'
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type Tool,
  type ToolAnnotations,
  type Transport,
} from '@modelcontextprotocol/client'
import type {
  ListedConnection,
  PluginFetch,
  SecretStore,
} from '../connections/index.ts'
import { parseForm, type QuestionsApi } from '../questions/index.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { idleDeadline, type IdleDeadline } from './deadline.ts'
import { httpTransport } from './http-transport.ts'
import type { McpServer, McpStdioFactory, McpStatus } from './servers.ts'
import { defineTool } from '../tools.ts'
import {
  admitBackgroundMcp,
  type McpInvocation,
  type createBackgroundMcp,
} from './background.ts'
import { toolResult } from './tool-result.ts'

const TIMEOUT_MS = 15_000
/** How long a local server has to answer the protocol probe (see below). */
const STDIO_PROBE_MS = 3_000
/** How long a call may go without the server answering or reporting progress. */
const CALL_IDLE_MS = 60_000
/**
 * The SDK's own limit on a call, which can't pause while the person
 * answers a question, so only `CALL_IDLE_MS` applies in practice.
 */
const CALL_MAX_MS = 24 * 60 * 60_000

/** The extension a server's tools are installed as, once for every Familiar. */
export const mcpExtensionName = (server: string) => `familiar.mcp.${server}`

/**
 * One server's connection: its client, its status and its tools in the
 * registry, until closed. A closed connection changes nothing, whatever is
 * still finishing.
 */
export function openConnection(
  server: McpServer,
  registry: Registry,
  options: {
    fetch?: PluginFetch
    secrets?: SecretStore
    stdio?: McpStdioFactory
    /** Where a server's questions for the person go; without it, it can't ask. */
    questions?: Pick<QuestionsApi, 'ask'>
    /** The server forgot its session; the owner of connections replaces this one. */
    expired(): void
    background: ReturnType<typeof createBackgroundMcp>
    edit<T>(run: () => Promise<T>): Promise<T>
  },
) {
  const extensionName = mcpExtensionName(server.name)
  const closing = new AbortController()
  const { signal } = closing
  let info: Extract<ListedConnection, { kind: 'mcp' }> = {
    ...server,
    kind: 'mcp',
    title: server.name,
    secrets: [],
    tools: [],
    status: { type: 'connecting' },
  }
  const update = (status: McpStatus, tools = info.tools) => {
    if (!signal.aborted) {
      info = { ...info, status, tools }
    }
  }
  const failed = (error: unknown) =>
    update(
      error instanceof SdkHttpError && error.status === 401
        ? { type: 'needs-auth' }
        : {
            type: 'failed',
            error: error instanceof Error ? error.message : String(error),
          },
    )

  const client = new Client(
    { name: 'familiar', version: '1.0.0' },
    {
      // Servers can ask the person mid-call, through Familiar's questions.
      capabilities: options.questions ? { elicitation: { form: {} } } : {},
      // A 2026 server asks between a call's requests, so nothing times out
      // while the person decides; older servers still connect as before.
      // A local process silent this long is an older one: the SDK starts
      // it afresh the old way rather than waiting out the connect timeout.
      versionNegotiation: {
        mode: 'auto',
        ...(server.transport.type === 'stdio' && {
          probe: { timeoutMs: STDIO_PROBE_MS },
        }),
      },
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (error) {
              failed(error)
              return
            }
            try {
              install(tools ?? [])
            } catch (error) {
              failed(error)
            }
          },
        },
      },
    },
  )

  // Calls in progress, newest last. MCP doesn't say which call a server's
  // question belongs to, so it's shown with the newest, and every call's
  // deadline waits while it's open.
  const calls: {
    familiar: FamiliarId
    callId: string
    tool: string
    deadline: IdleDeadline
    background: boolean
  }[] = []

  const { questions } = options
  if (questions) {
    client.setRequestHandler('elicitation/create', async (request, ctx) => {
      const call = calls.at(-1)
      if (
        !call ||
        request.params.mode === 'url' ||
        // Legacy MCP cannot reliably identify which overlapping call asked.
        calls.some((active) => active.background)
      ) {
        return { action: 'decline' }
      }
      const waiting = [...calls]
      waiting.forEach((active) => active.deadline.pause())
      try {
        const form =
          'requestedSchema' in request.params
            ? parseForm(request.params.requestedSchema)
            : undefined
        const answer = await questions.ask(
          {
            kind: 'elicitation',
            familiar: call.familiar,
            callId: call.callId,
            tool: call.tool,
            server: server.name,
            message: request.params.message,
            ...(form && { form }),
          },
          withAbortSignal(
            AbortSignal.any([ctx.mcpReq.signal, call.deadline.signal]),
            BACKGROUND_CONTEXT,
          ),
        )
        return answer.action === 'accept'
          ? { action: 'accept', content: answer.content ?? {} }
          : // Moved on: dismissed rather than refused.
            { action: answer.action === 'moved-on' ? 'cancel' : 'decline' }
      } catch {
        // Stopped, or the server gave up waiting.
        return { action: 'cancel' }
      } finally {
        waiting.forEach((active) => active.deadline.resume())
      }
    })
  }

  const invoke = async (
    input: McpInvocation,
    context: Context,
    background: boolean,
  ) => {
    signal.throwIfAborted()
    const callSignal = context.abortSignal
      ? AbortSignal.any([context.abortSignal, signal])
      : signal
    const deadline = idleDeadline(CALL_IDLE_MS, callSignal)
    const call = {
      familiar: input.familiar,
      callId: input.callId,
      tool: input.tool,
      deadline,
      background,
    }
    calls.push(call)
    try {
      return toolResult(
        await client.callTool(
          {
            name: input.name,
            arguments: input.args,
          },
          {
            signal: deadline.signal,
            timeout: CALL_MAX_MS,
            onprogress: deadline.restart,
          },
        ),
      )
    } catch (error) {
      if (deadline.expired) {
        throw new Error(
          `${server.name} didn't answer for ${CALL_IDLE_MS / 1000}s.`,
          { cause: error },
        )
      }
      if (!context.abortSignal?.aborted && !signal.aborted) {
        if (error instanceof SdkHttpError && error.status === 401) {
          failed(error)
        } else if (error instanceof SdkHttpError && error.status === 404) {
          options.expired()
        }
      }
      throw error
    } finally {
      deadline.done()
      calls.splice(calls.indexOf(call), 1)
    }
  }

  // The server's tools as deferred Pi tools, found through tool_search,
  // which every server's extension carries. Pi offers one tool per name, so
  // a Familiar has tool search exactly when it uses an MCP connection.
  const install = (tools: Tool[]) => {
    const extension: Extension = {
      name: extensionName,
      tools: [
        createToolSearchTool(),
        ...tools.map((tool) => {
          const name = `mcp__${server.name}__${tool.name}`
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
            throw new Error(`Unsupported MCP tool name: ${name}`)
          }
          return defineTool({
            name,
            description: withHints(
              tool.description ?? tool.name,
              tool.annotations,
            ),
            parameters: tool.inputSchema,
            deferred: true,
            replay: 'unsafe',
            ...(tool.annotations && { annotations: tool.annotations }),
            execute: async (args, api, context) => {
              const invocation: McpInvocation = {
                server: server.name,
                name: tool.name,
                tool: name,
                args: args as JsonObject,
                familiar: api.conversationId,
                callId: api.callId,
              }
              const receipt = await admitBackgroundMcp(
                options.background,
                invocation,
                api,
                context,
                (commit) =>
                  options.edit(() => {
                    signal.throwIfAborted()
                    return commit()
                  }),
              )
              return receipt ?? invoke(invocation, context, false)
            },
          })
        }),
      ],
    }
    if (!signal.aborted) {
      registry.install(extension)
      update(
        { type: 'connected' },
        tools.map((tool) => ({
          name: tool.name,
          ...(tool.description !== undefined && {
            description: tool.description,
          }),
          ...(tool.annotations && { annotations: tool.annotations }),
        })),
      )
    }
  }

  const token = () =>
    options.secrets?.get({ kind: 'mcp', name: server.name }, 'token') ??
    Promise.resolve(undefined)

  const transportFor = (config: McpServer['transport']): Transport => {
    if (config.type === 'stdio') {
      if (!options.stdio) {
        throw new Error('This host has no MCP stdio transport.')
      }
      return options.stdio(config)
    }
    if (!options.fetch) {
      throw new Error('This host has no MCP HTTP transport.')
    }
    return httpTransport(
      config,
      options.fetch,
      async () => {
        const value = await token()
        if (!value) {
          throw new Error('MCP bearer token is missing.')
        }
        return value
      },
      signal,
    )
  }

  // Set once connected: only an open session is ended on close.
  let connected: Transport | undefined
  const ready = (async () => {
    const config = server.transport
    try {
      if (
        config.type === 'http' &&
        config.auth.type === 'bearer' &&
        !(await token())
      ) {
        update({ type: 'needs-auth' })
        return
      }
      signal.throwIfAborted()
      const transport = transportFor(config)
      await client.connect(transport, { timeout: TIMEOUT_MS, signal })
      const { tools } = await client.listTools(undefined, {
        timeout: TIMEOUT_MS,
        signal,
      })
      connected = transport
      install(tools)
      // Only an established client reports closing; a failed start may
      // finish closing later.
      client.onclose = () => {
        if (!signal.aborted) {
          registry.uninstall({ name: extensionName })
          update({ type: 'disconnected' }, [])
        }
      }
    } catch (error) {
      failed(error)
      await client.close()
    }
  })()

  return {
    server,
    invoke,
    info: () => structuredClone(info),
    close: async () => {
      closing.abort()
      registry.uninstall({ name: extensionName })
      await ready
      if (connected instanceof StreamableHTTPClientTransport) {
        try {
          await connected.terminateSession()
        } catch {
          /* The session may already be expired or unreachable. */
        }
      }
      await client.close()
      info = { ...info, status: { type: 'disconnected' }, tools: [] }
    },
  }
}

// What a tool's declared hints mean, for the model. Only hints set true say
// anything, so an unannotated tool reads as its server wrote it.
const HINTS = [
  ['readOnlyHint', 'Read-only.'],
  ['destructiveHint', 'May be destructive.'],
  ['idempotentHint', 'Idempotent.'],
  ['openWorldHint', 'Reaches outside its server.'],
] as const

function withHints(description: string, annotations?: ToolAnnotations) {
  const notes = HINTS.filter(([hint]) => annotations?.[hint] === true)
  return notes.length === 0
    ? description
    : `${description}\n\n${notes.map(([, note]) => note).join(' ')}`
}
