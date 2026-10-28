import type { Extension } from '@earendil-works/pi-durable'
import type { Notification, Notify } from '../schedules/index.ts'
import { authorizedFetch, checkDeclaration } from './authorized-fetch.ts'
import { createSecrets, type Connection, type SecretStore } from './secrets.ts'

export { memorySecrets, type Connection, type SecretStore } from './secrets.ts'

/**
 * How plugins reach the network: the Fetch API's signature, so a host can
 * pass `fetch` itself where that's safe.
 */
export type PluginFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * What Familiar gives a plugin's extension. Never a secret's value: a plugin
 * that can't see one can't echo it, log it, or send it somewhere else.
 */
export type PluginContext = {
  now(): number
  notify(notification: Notification): Promise<void>
  /** The host's fetch, which keeps plugins off its private networks. */
  fetch: PluginFetch
  /**
   * A request carrying the named secret, made through `fetch` only if it
   * matches what the secret declares; otherwise throws without sending.
   * Throws a message the model reads as "not connected" when it isn't set.
   * Redirects come back as responses, unfollowed.
   */
  authorizedFetch(
    secret: string,
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>
}

export type PluginSecret = {
  name: string
  /** For the owner, on the Connections page. */
  label: string
  help?: string
  /** Where core sends it. Nothing else does. */
  sendAs: {
    header: string
    /** Before the value, such as `Bearer `. */
    prefix?: string
    /** Exactly, such as `https://api.example.com`: no subdomains. */
    origin: string
    /** Exactly; no patterns. */
    requests: { method: string; path: string }[]
  }
}

/**
 * Everything that isn't core arrives as a plugin: a Pi extension, built with
 * what Familiar provides around it. Core names the extension
 * `familiar.plugin.<name>`.
 */
export type FamiliarPlugin = {
  /** Keys its secrets, so keep it stable. */
  name: string
  /** For the owner, on the Connections page. */
  title: string
  secrets?: PluginSecret[]
  extension: (context: PluginContext) => Extension
}

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

/** A connection as the owner sees it: never a secret's value. */
export type ConnectionInfo = {
  kind: 'plugin'
  name: string
  title: string
  secrets: {
    name: string
    label: string
    help?: string
    /** Where it's sent, so the owner knows who they're trusting with it. */
    origin: string
    set: boolean
  }[]
}

export type ConnectionsApi = {
  list(): Promise<ConnectionInfo[]>
  /** Rejects with a ConnectionError when the connection has no such secret. */
  setSecret(
    connection: Connection,
    secret: string,
    value: string,
  ): Promise<void>
  /** Rejects with a ConnectionError when the connection has no such secret. */
  deleteSecret(connection: Connection, secret: string): Promise<void>
}

export class ConnectionError extends Error {}

export type PluginsOptions = {
  plugins: readonly FamiliarPlugin[]
  secrets?: SecretStore
  fetch?: PluginFetch
  notify?: Notify
  now: () => number
}

const unavailableFetch: PluginFetch = () =>
  Promise.reject(new Error('This Familiar has no network access for plugins.'))

/**
 * Plugins and their secrets: each plugin's extension, its tools wrapped to
 * redact secret values from everything they report, as a second line of
 * defence for a plugin that echoes one. Install `extensions` after core's.
 */
export function createPlugins(options: PluginsOptions) {
  const byName = new Map<string, FamiliarPlugin>()
  for (const plugin of options.plugins) {
    if (byName.has(plugin.name)) {
      throw new Error(`Two plugins are named ${plugin.name}.`)
    }
    byName.set(plugin.name, plugin)
    for (const secret of plugin.secrets ?? []) {
      checkDeclaration(plugin.name, secret)
    }
  }

  const connectionOf = (plugin: FamiliarPlugin): Connection => ({
    kind: 'plugin',
    name: plugin.name,
  })

  const secrets = createSecrets(options.secrets, () =>
    options.plugins.flatMap((plugin) =>
      (plugin.secrets ?? []).map(({ name }) => ({
        connection: connectionOf(plugin),
        secret: name,
      })),
    ),
  )

  const declared = (connection: Connection, secret: string) => {
    const plugin =
      connection.kind === 'plugin' ? byName.get(connection.name) : undefined
    const declaration = plugin?.secrets?.find(({ name }) => name === secret)
    if (!declaration) {
      throw new ConnectionError(
        `${connection.kind} ${connection.name} has no secret ${secret}.`,
      )
    }
    return declaration
  }

  const fetch = options.fetch ?? unavailableFetch

  const contextFor = (plugin: FamiliarPlugin): PluginContext => ({
    now: options.now,
    notify: options.notify ?? (async () => {}),
    fetch,
    authorizedFetch: async (name, input, init) => {
      const secret = declared(connectionOf(plugin), name)
      const value = async () => {
        const value = await secrets.get(connectionOf(plugin), name)
        if (!value) {
          throw new Error(
            `${plugin.title} isn't connected. Ask the owner to add ${secret.label} on the Connections page.`,
          )
        }
        return value
      }
      let response: Response
      try {
        response = await authorizedFetch(fetch, secret, value, input, init)
      } catch (error) {
        // The host's fetch may name the request's headers in its error.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(
          secrets.redactString(
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
      return secrets.redactResponse(response)
    },
  })

  const extensions = options.plugins.map((plugin): Extension => {
    const extension = plugin.extension(contextFor(plugin))
    return {
      ...extension,
      name: `familiar.plugin.${plugin.name}`,
      tools: extension.tools?.map(secrets.redactTool),
    }
  })

  const api: ConnectionsApi = {
    list: () =>
      Promise.all(
        options.plugins.map(async (plugin) => ({
          kind: 'plugin' as const,
          name: plugin.name,
          title: plugin.title,
          secrets: await Promise.all(
            (plugin.secrets ?? []).map(async (secret) => ({
              name: secret.name,
              label: secret.label,
              help: secret.help,
              origin: secret.sendAs.origin,
              set: Boolean(
                await secrets.get(connectionOf(plugin), secret.name),
              ),
            })),
          ),
        })),
      ),
    setSecret: async (connection, secret, value) => {
      declared(connection, secret)
      await secrets.set(connection, secret, value)
    },
    deleteSecret: async (connection, secret) => {
      declared(connection, secret)
      await secrets.delete(connection, secret)
    },
  }

  return { extensions, api }
}
