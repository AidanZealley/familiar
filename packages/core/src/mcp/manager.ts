import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search'
import type { Harness, Registry } from '@earendil-works/pi-durable'
import { ConnectionError, secretValue } from '../plugins/connections.ts'
import type { ConnectionsApi, PluginFetch } from '../plugins/types.ts'
import type { Connection, SecretStore } from '../plugins/secrets.ts'
import { openConnection } from './connection.ts'
import {
  McpServers,
  parseServer,
  tokenDeclaration,
  type McpServer,
} from './servers.ts'
import type { McpApi, McpStdioFactory } from './types.ts'

/** Owns saved declarations and serializes owner edits, never network startup. */
export async function createMcp(
  harness: Harness,
  registry: Registry,
  options: {
    fetch?: PluginFetch
    secrets?: SecretStore
    stdio?: McpStdioFactory
  },
) {
  const entries = new Map<string, ReturnType<typeof openConnection>>()
  const lifetime = new AbortController()
  // Only owner edits serialize. Servers connect independently in the background.
  let edits = Promise.resolve()
  const edit = (run: () => Promise<void>) => {
    const next = edits.then(() => {
      lifetime.signal.throwIfAborted()
      return run()
    })
    edits = next.catch(() => {})
    return next
  }
  const get = (name: string) => {
    const entry = entries.get(name)
    if (!entry) {
      throw new ConnectionError(`No MCP server ${name}.`)
    }
    return entry
  }
  const start = (server: McpServer) => {
    registry.install(createToolSearchExtension())
    const entry = openConnection(server, registry, {
      ...options,
      expired: () => {
        void edit(async () => {
          if (entries.get(server.name) === entry) {
            await reconnect(server.name)
          }
        }).catch(() => {})
      },
    })
    entries.set(server.name, entry)
  }
  const reconnect = async (name: string) => {
    const entry = get(name)
    await entry.close()
    start(entry.server)
  }
  const api: McpApi = {
    add: (input) =>
      edit(async () => {
        const server = parseServer(input)
        if (entries.has(server.name)) {
          throw new ConnectionError(`MCP server ${server.name} already exists.`)
        }
        // A secret store can outlive the conversation that declared this name.
        await options.secrets?.delete(
          { kind: 'mcp', name: server.name },
          'token',
        )
        await harness.commit(async (tx) => {
          const doc = await tx.doc(McpServers)
          doc.servers.push(server)
        }, BACKGROUND_CONTEXT)
        start(server)
      }),
    remove: (name) =>
      edit(async () => {
        const entry = get(name)
        await entry.close()
        await options.secrets?.delete({ kind: 'mcp', name }, 'token')
        await harness.commit(async (tx) => {
          const doc = await tx.doc(McpServers)
          doc.servers = doc.servers.filter((server) => server.name !== name)
        }, BACKGROUND_CONTEXT)
        entries.delete(name)
      }),
    reconnect: (name) => edit(() => reconnect(name)),
  }
  const changeSecret = (
    connection: Connection,
    secret: string,
    write: () => Promise<void>,
  ) =>
    edit(async () => {
      const entry = get(connection.name)
      if (
        connection.kind !== 'mcp' ||
        secret !== 'token' ||
        entry.server.transport.type !== 'http' ||
        entry.server.transport.auth.type !== 'bearer'
      ) {
        throw new ConnectionError(
          `MCP server ${connection.name} has no secret ${secret}.`,
        )
      }
      await entry.close()
      try {
        await write()
      } finally {
        start(entry.server)
      }
    })
  const connections: ConnectionsApi = {
    list: () =>
      Promise.all(
        [...entries.values()].map(async (entry) => {
          const info = entry.info()
          if (
            info.transport.type === 'http' &&
            info.transport.auth.type === 'bearer'
          ) {
            info.secrets = [
              {
                name: 'token',
                label: 'Bearer token',
                origin: tokenDeclaration(info.transport).sendAs.origin,
                set: Boolean(
                  await options.secrets?.get(
                    { kind: 'mcp', name: info.name },
                    'token',
                  ),
                ),
              },
            ]
          }
          return info
        }),
      ),
    setSecret: (connection, secret, input) => {
      const value = secretValue(input)
      if (!value) {
        return Promise.reject(
          new Error('A secret must be visible ASCII characters.'),
        )
      }
      if (!options.secrets) {
        return Promise.reject(new Error('This host keeps no secrets.'))
      }
      const store = options.secrets
      return changeSecret(connection, secret, () =>
        store.set(connection, secret, value),
      )
    },
    deleteSecret: (connection, secret) =>
      changeSecret(connection, secret, async () => {
        await options.secrets?.delete(connection, secret)
      }),
  }
  const saved = await harness.commit(
    async (tx) => (await tx.doc(McpServers)).servers.map(parseServer),
    BACKGROUND_CONTEXT,
  )
  saved.forEach(start)
  return {
    api,
    connections,
    close: async () => {
      lifetime.abort()
      await edits
      await Promise.all([...entries.values()].map((entry) => entry.close()))
    },
  }
}
