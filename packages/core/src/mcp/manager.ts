import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  type Harness,
  type Registry,
} from '@earendil-works/pi-durable'
import {
  ConnectionError,
  type Connection,
  type ConnectionsApi,
  type ConnectionsSource,
  type PluginFetch,
  type SecretStore,
} from '../connections/index.ts'
import {
  pruneToolSettings,
  ToolSettingsDocument,
  toolSettingsOf,
  removeToolSettings,
  updateToolSettings,
} from '../connections/tool-settings.ts'
import type { QuestionsApi } from '../questions/index.ts'
import {
  BACKGROUND_MCP_TASK,
  createBackgroundMcp,
  type BackgroundMcpInput,
} from './background.ts'
import { openConnection } from './connection.ts'
import {
  McpServers,
  parseServer,
  tokenDeclaration,
  type McpApi,
  type McpServer,
  type McpStdioFactory,
} from './servers.ts'

/** Owns saved declarations and serializes owner edits, never network startup. */
export async function createMcp(
  harness: Harness,
  registry: Registry,
  options: {
    fetch?: PluginFetch
    secrets?: SecretStore
    stdio?: McpStdioFactory
    questions?: Pick<QuestionsApi, 'ask'>
  },
) {
  const entries = new Map<string, ReturnType<typeof openConnection>>()
  const lifetime = new AbortController()
  // Only owner edits serialize. Servers connect independently in the background.
  let edits = Promise.resolve()
  const edit = <T>(run: () => Promise<T>) => {
    const next = edits.then(() => {
      lifetime.signal.throwIfAborted()
      return run()
    })
    edits = next.then(
      () => {},
      () => {},
    )
    return next
  }
  const get = (name: string) => {
    const entry = entries.get(name)
    if (!entry) {
      throw new ConnectionError(`No MCP server ${name}.`)
    }
    return entry
  }
  const background = createBackgroundMcp(async (input, context) => {
    const entry = get(input.server)
    if (!entry.info().tools.some((tool) => tool.name === input.name)) {
      throw new ConnectionError(`MCP tool ${input.tool} is unavailable.`)
    }
    const settings = await harness.snapshot(ToolSettingsDocument, context)
    if (
      !toolSettingsOf(
        settings,
        { kind: 'mcp', name: input.server },
        input.name,
        undefined,
      ).enabled
    ) {
      throw new ConnectionError(
        `The owner has turned ${input.tool} off in Familiar.`,
      )
    }
    return entry.invoke(input, context, true)
  })
  registry.install(
    defineExtension({ name: 'familiar.mcp-background', tasks: [background] }),
  )

  const stopBackground = async (name: string) => {
    const { tasks } = await harness.inspect(BACKGROUND_CONTEXT)
    const jobs = tasks
      .map(({ record }) => record)
      .filter(
        (task) =>
          task.kind === BACKGROUND_MCP_TASK &&
          (task.input as BackgroundMcpInput).server === name,
      )
    await Promise.all(
      jobs.map(({ id }) => harness.abortTask(id, BACKGROUND_CONTEXT)),
    )
    await Promise.all(
      jobs.map(({ id }) => harness.waitForTask(id, BACKGROUND_CONTEXT)),
    )
  }

  const start = (server: McpServer) => {
    const entry = openConnection(server, registry, {
      ...options,
      background,
      edit,
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
        await stopBackground(name)
        await entry.close()
        await options.secrets?.delete({ kind: 'mcp', name }, 'token')
        await harness.commit(async (tx) => {
          const doc = await tx.doc(McpServers)
          await removeToolSettings(tx, { kind: 'mcp', name })
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
  const connections: ConnectionsSource &
    Pick<ConnectionsApi, 'updateToolSettings'> = {
    updateToolSettings: (connection, tool, change) =>
      edit(async () => {
        get(connection.name)
        await harness.commit(
          (tx) => updateToolSettings(tx, connection, tool, change),
          BACKGROUND_CONTEXT,
        )
      }),
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
    // allConnections has checked the value and that there is a store.
    setSecret: (connection, secret, value) =>
      changeSecret(connection, secret, async () => {
        await options.secrets?.set(connection, secret, value)
      }),
    deleteSecret: (connection, secret) =>
      changeSecret(connection, secret, async () => {
        await options.secrets?.delete(connection, secret)
      }),
  }
  const saved = await harness.commit(async (tx) => {
    const servers = (await tx.doc(McpServers)).servers.map(parseServer)
    await pruneToolSettings(
      tx,
      'mcp',
      servers.map(({ name }) => name),
    )
    return servers
  }, BACKGROUND_CONTEXT)
  saved.forEach(start)
  return {
    api,
    connections,
    /** Every configured server's name, connected or not. */
    names: () => [...entries.keys()],
    close: async () => {
      lifetime.abort()
      await edits
      await Promise.all([...entries.values()].map((entry) => entry.close()))
    },
  }
}
