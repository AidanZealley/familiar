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

const encoder = new TextEncoder()
const REDACTED_BYTES = encoder.encode(REDACTED)

/** Statuses whose responses can't have a body. */
const NULL_BODY = new Set([101, 204, 205, 304])

const concat = (parts: readonly Uint8Array[]) => {
  const joined = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  )
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const startsWithAt = (bytes: Uint8Array, value: Uint8Array, at: number) => {
  if (at + value.length > bytes.length) {
    return false
  }
  for (let i = 0; i < value.length; i++) {
    if (bytes[at + i] !== value[i]) {
      return false
    }
  }
  return true
}

/** `bytes` with each of `values` (longest first) replaced by `[secret]`. */
const redactBytes = (bytes: Uint8Array, values: readonly Uint8Array[]) => {
  const parts: Uint8Array[] = []
  let start = 0
  for (let at = 0; at < bytes.length;) {
    const value = values.find((value) => startsWithAt(bytes, value, at))
    if (value) {
      parts.push(bytes.subarray(start, at), REDACTED_BYTES)
      at += value.length
      start = at
    } else {
      at++
    }
  }
  parts.push(bytes.subarray(start))
  return concat(parts)
}

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

  // Known values as bytes, longest first so one inside another is covered
  // whole; rebuilt only when a value is learned.
  let knownBytes: Uint8Array[] = []
  const currentBytes = () => {
    if (knownBytes.length !== known.size) {
      knownBytes = [...known]
        .map((value) => encoder.encode(value))
        .sort((a, b) => b.length - a.length)
    }
    return knownBytes
  }

  /**
   * Redacts a stream of bytes as it passes, holding back only enough to
   * catch a value split across chunks: one byte less than the longest value.
   * Each chunk is checked against the values known then, so a value learned
   * while the stream runs is caught too. `push` returns what's safe to pass
   * on; `end` returns the rest.
   */
  const redactStream = () => {
    let held = new Uint8Array(0)
    return {
      push: (chunk: Uint8Array) => {
        const values = currentBytes()
        const hold = Math.max(1, ...values.map((value) => value.length)) - 1
        const redacted = redactBytes(concat([held, chunk]), values)
        const cut = Math.max(0, redacted.length - hold)
        held = redacted.slice(cut)
        return redacted.subarray(0, cut)
      },
      end: () => {
        const rest = held
        held = new Uint8Array(0)
        return rest
      },
    }
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
     * A service's response with every known secret value in its headers and
     * body replaced by `[secret]`, so a service that echoes the key it was
     * sent doesn't hand it to plugin code. A header whose name holds one is
     * dropped, since `[secret]` isn't a valid name.
     */
    redactResponse: async (response: Response): Promise<Response> => {
      await load()
      const stream = redactStream()
      const body =
        response.body && !NULL_BODY.has(response.status)
          ? response.body.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform: (chunk, controller) => {
                  const safe = stream.push(chunk)
                  if (safe.length > 0) {
                    controller.enqueue(safe)
                  }
                },
                flush: (controller) => {
                  const rest = stream.end()
                  if (rest.length > 0) {
                    controller.enqueue(rest)
                  }
                },
              }),
            )
          : null
      // Only what's checked crosses: header names and values, and no status
      // text, which is the service's to choose and rarely useful.
      const headers = new Headers()
      response.headers.forEach((value, name) => {
        if (redactString(name) === name) {
          headers.append(name, redactString(value))
        }
      })
      const redacted = new Response(body, {
        status: response.status,
        headers,
      })
      // Read-only on a constructed Response, but plugins need them.
      Object.defineProperties(redacted, {
        url: { value: response.url },
        redirected: { value: response.redirected },
      })
      return redacted
    },
    redactString,
    /**
     * The tool with every known secret value replaced by `[secret]` wherever
     * it reports: progress, its result, and errors it throws. Progress is
     * redacted before Pi commits it, because Pi streams it to clients and
     * keeps it as the result of a call that's aborted. Output passes through
     * to Pi as it arrives, so Pi's limits still bound it, less the few bytes
     * held back to catch a value split across chunks.
     */
    redactTool: <Tool extends ToolRegistration>(tool: Tool): Tool => ({
      ...tool,
      execute: async (
        args: unknown,
        api: ToolExecutionApi,
        context: Parameters<Tool['execute']>[2],
      ) => {
        await load()
        const stream = redactStream()
        const decoder = new TextDecoder()
        const emit = (bytes: Uint8Array, last = false) => {
          const text = decoder.decode(bytes, { stream: !last })
          if (text) {
            api.output(text)
          }
        }
        const redacting: ToolExecutionApi = {
          ...api,
          // Pi's docs: a wrapper that transforms output must clear this, so
          // skipped text can't bypass it.
          outputWindow: undefined,
          output: (chunk) =>
            emit(
              stream.push(
                typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
              ),
            ),
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
        } finally {
          emit(stream.end(), true)
        }
        return redactJson(result)
      },
    }),
  }
}
