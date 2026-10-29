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
