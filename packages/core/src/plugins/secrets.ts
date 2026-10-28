import type { ToolExecutionResult } from '@earendil-works/pi-durable'

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

  // Generic, for the result's typed channels; all of them are JSON.
  const redactJson = <Value>(value: Value): Value => {
    if (typeof value === 'string') {
      return redactString(value) as Value
    }
    if (Array.isArray(value)) {
      return value.map(redactJson) as Value
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactJson(item)]),
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
    /** The result with every known secret value replaced by `[secret]`. */
    redact: async (
      result: ToolExecutionResult,
    ): Promise<ToolExecutionResult> => {
      await load()
      if (known.size === 0) {
        return result
      }
      // Every channel a tool's text reaches someone on, including error text
      // in diagnostics. `control` and `usage` are the Harness's, not text.
      return {
        ...result,
        output: redactJson(result.output),
        structuredOutput: redactJson(result.structuredOutput),
        details: redactJson(result.details),
        diagnostics: result.diagnostics?.map((diagnostic) => ({
          ...diagnostic,
          message: redactString(diagnostic.message),
        })),
      }
    },
  }
}
