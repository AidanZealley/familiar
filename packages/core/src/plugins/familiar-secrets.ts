import type { SecretStore } from '../connections/index.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import type { FamiliarPlugin } from './types.ts'

/** A plugin's private values for one Familiar, by the names it declared. */
export type FamiliarSecrets = {
  get(name: string): Promise<string | undefined>
  /**
   * Replaces the value with what `change` returns from the current one
   * (undefined deletes it), after every earlier change to this Familiar's
   * secrets, so changes never lose each other. Throws once the Familiar's
   * secrets are being deleted.
   */
  update(
    name: string,
    change: (value: string | undefined) => string | undefined,
  ): Promise<void>
}

/** Where a Familiar secret is kept, apart from a plugin's declared ones. */
export const FAMILIAR_SECRET_PREFIX = 'familiar/'

/**
 * The one owner of every plugin's per-Familiar secrets, kept in the host's
 * store under the plugin's connection as `familiar/<id>/<name>`, only by
 * declared names, so removing a Familiar knows every one to delete. Each
 * Familiar's reads and writes run one at a time, and removing it runs in
 * the same line: it refuses changes from then on, for good, and deletes
 * after every change already admitted, so none can bring a secret back.
 * Only remove.ts removes, once the Familiar is gone. Closing refuses every
 * change and waits for those admitted, so none outlives the workspace.
 */
export function familiarSecrets(
  store: SecretStore,
  plugins: readonly FamiliarPlugin[],
) {
  const lines = new Map<FamiliarId, Promise<void>>()
  /** Each Familiar whose secrets are being deleted, or were: its deletion. */
  const removals = new Map<FamiliarId, Promise<void>>()
  let closed = false

  /** Runs `work` after everything before it for `familiar`. */
  const inLine = <T>(familiar: FamiliarId, work: () => Promise<T>) => {
    const result = (lines.get(familiar) ?? Promise.resolve()).then(work)
    lines.set(
      familiar,
      result.then(
        () => {},
        () => {},
      ),
    )
    return result
  }

  const key = (plugin: FamiliarPlugin, familiar: FamiliarId, name: string) => {
    if (!plugin.familiarSecrets?.includes(name)) {
      throw new Error(`Add ${name} to ${plugin.name}'s familiarSecrets.`)
    }
    return [
      { kind: 'plugin', name: plugin.name },
      `${FAMILIAR_SECRET_PREFIX}${familiar}/${name}`,
    ] as const
  }

  return {
    /** `plugin`'s secrets for `familiar`. */
    for: (plugin: FamiliarPlugin, familiar: FamiliarId): FamiliarSecrets => ({
      get: async (name) => {
        const [connection, secret] = key(plugin, familiar, name)
        return inLine(familiar, () => store.get(connection, secret))
      },
      update: async (name, change) => {
        const [connection, secret] = key(plugin, familiar, name)
        if (closed) {
          throw new Error('The workspace is closed.')
        }
        if (removals.has(familiar)) {
          throw new Error('This Familiar is being removed.')
        }
        await inLine(familiar, async () => {
          const before = await store.get(connection, secret)
          const after = change(before)
          if (after === before) {
            return
          }
          await (after === undefined
            ? store.delete(connection, secret)
            : store.set(connection, secret, after))
        })
      },
    }),
    /** Deletes every plugin's secrets for a removed Familiar. */
    remove: (familiar: FamiliarId) => {
      const removal =
        removals.get(familiar) ??
        inLine(familiar, async () => {
          for (const plugin of plugins) {
            for (const name of plugin.familiarSecrets ?? []) {
              await store.delete(...key(plugin, familiar, name))
            }
          }
        })
      removals.set(familiar, removal)
      return removal
    },
    /** Refuses changes from now on; settles once those admitted have. */
    close: async () => {
      closed = true
      await Promise.all(lines.values())
    },
  }
}

export type FamiliarSecretsApi = ReturnType<typeof familiarSecrets>
