import type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from '@earendil-works/pi-durable'

/** What owns a secret: a plugin, or (later) an MCP server. */
export type Connection = { kind: 'plugin' | 'mcp'; name: string }

/**
 * Where the host keeps secrets: the daemon in its data directory, a Cloudflare
 * host in its own storage. Core never lists it; it asks for names it knows.
 */
export type SecretStore = {
  get(connection: Connection, secret: string): Promise<string | undefined>
  set(connection: Connection, secret: string, value: string): Promise<void>
  delete(connection: Connection, secret: string): Promise<void>
}

/** A store that lasts as long as the process, for tests and demos. */
export function memorySecrets(): SecretStore {
  const values = new Map<string, string>()
  const key = (connection: Connection, secret: string) =>
    JSON.stringify([connection.kind, connection.name, secret])
  return {
    get: async (connection, secret) => values.get(key(connection, secret)),
    set: async (connection, secret, value) => {
      values.set(key(connection, secret), value)
    },
    delete: async (connection, secret) => {
      values.delete(key(connection, secret))
    },
  }
}

/** Shorter values are too likely to appear in ordinary text. */
const REDACT_MIN_LENGTH = 8

const REDACTED = '[secret]'

/**
 * The one way core reads and writes secrets, so it knows every value that
 * could appear in a tool's result. Values stay known after they're replaced
 * or deleted, so a call that started with one is still redacted.
 */
export function createSecrets(
  store: SecretStore | undefined,
  /** Every secret core may hold, to learn their values before the first redaction. */
  declared: () => { connection: Connection; secret: string }[],
) {
  const known = new Set<string>()
  const learn = (value: string | undefined) => {
    if (value !== undefined && value.length >= REDACT_MIN_LENGTH) {
      known.add(value)
    }
    return value
  }

  let loaded: Promise<unknown> | undefined
  const load = () =>
    (loaded ??= Promise.all(
      declared().map(({ connection, secret }) =>
        store?.get(connection, secret).then(learn),
      ),
    ))

  const redactString = (text: string) => {
    let redacted = text
    for (const value of known) {
      redacted = redacted.replaceAll(value, REDACTED)
    }
    return redacted
  }

  // Generic, for the typed channels a tool reports on; all of them are JSON.
  // Keys too: a plugin may index results by an authenticated URL.
  const redactJson = <Value>(value: Value): Value => {
    if (typeof value === 'string') {
      return redactString(value) as Value
    }
    if (Array.isArray(value)) {
      return value.map(redactJson) as Value
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redactString(key),
          redactJson(item),
        ]),
      ) as Value
    }
    return value
  }

  return {
    get: async (connection: Connection, secret: string) =>
      learn(await store?.get(connection, secret)),
    set: async (connection: Connection, secret: string, value: string) => {
      if (!store) {
        throw new Error('This host keeps no secrets.')
      }
      await store.set(connection, secret, value)
      learn(value)
    },
    delete: async (connection: Connection, secret: string) => {
      await store?.delete(connection, secret)
    },
    /**
     * The tool with every known secret value replaced by `[secret]` wherever
     * it reports: progress, its result, and errors it throws. Progress is
     * redacted before Pi commits it, because Pi streams it to clients and
     * keeps it as the result of a call that's aborted. Output is held until
     * the call returns, so a value split across chunks is still found, and
     * an aborted call keeps none.
     */
    redactTool: <Tool extends ToolRegistration>(tool: Tool): Tool => ({
      ...tool,
      execute: async (
        args: unknown,
        api: ToolExecutionApi,
        context: Parameters<Tool['execute']>[2],
      ) => {
        await load()
        const decoder = new TextDecoder()
        let output = ''
        const redacting: ToolExecutionApi = {
          ...api,
          // Pi's docs: a wrapper that transforms output must clear this, so
          // skipped text can't bypass it.
          outputWindow: undefined,
          output: (chunk) => {
            output +=
              typeof chunk === 'string'
                ? chunk
                : decoder.decode(chunk, { stream: true })
          },
          retainedOutput: () => ({
            text: redactString(output),
            truncated: false,
          }),
          diagnostic: (diagnostic) => api.diagnostic(redactJson(diagnostic)),
          details: (value, detailsContext) =>
            api.details(redactJson(value), detailsContext),
        }
        let result: ToolExecutionResult
        try {
          result = await tool.execute(args as never, redacting, context)
        } catch (error) {
          // No `cause`: the original's message is what holds the secret.
          // eslint-disable-next-line preserve-caught-error
          throw new Error(
            redactString(
              error instanceof Error ? error.message : String(error),
            ),
          )
        }
        return redactJson({
          ...result,
          output:
            result.output ??
            (output ? [{ type: 'text' as const, text: output }] : undefined),
        })
      },
    }),
  }
}
