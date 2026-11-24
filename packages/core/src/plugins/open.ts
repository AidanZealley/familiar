import type { FamiliarId } from '../workspace/familiars.ts'
import type { FamiliarSecretsApi } from './familiar-secrets.ts'
import type { FamiliarPlugin } from './types.ts'

export type OpenPluginsOptions = {
  /** The Familiars that use a plugin now, read from storage. */
  usersOf: (plugin: string) => Promise<FamiliarId[]>
  /** Each Familiar's plugin secrets, when the host keeps secrets. */
  familiarSecrets?: FamiliarSecretsApi
  /** Fires `change` whenever who uses a plugin may have changed. */
  changes: EventTarget
}

/**
 * Opens each plugin that has `open`, in order, and returns what closes them
 * all. Storage owns who uses each plugin: a watch rereads it on each
 * `change` and tells its listener only when it differs. Each plugin's open
 * settles only once every watch it began has told its listener who uses it
 * now, so a workspace that resumes work afterwards never reaches a plugin
 * that hasn't heard.
 */
export async function openPlugins(
  plugins: readonly FamiliarPlugin[],
  { usersOf, familiarSecrets, changes }: OpenPluginsOptions,
) {
  const watching = new AbortController()
  const closes: (() => void | Promise<void>)[] = []

  /** Closes every plugin, latest first, even if some fail. */
  const close = async () => {
    watching.abort()
    const failures: unknown[] = []
    for (const close of closes.splice(0).reverse()) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Plugins failed to close')
    }
  }

  try {
    for (const plugin of plugins) {
      /** Each watch's first telling, begun while the plugin opens. */
      const firsts: Promise<void>[] = []
      const closePlugin = await plugin.open?.({
        secretsFor:
          familiarSecrets &&
          ((familiar) => familiarSecrets.for(plugin, familiar)),
        watchFamiliars: (listener) => {
          let told: string | undefined
          let reading = Promise.resolve()
          const update = () => {
            reading = reading
              .then(async () => {
                const familiars = await usersOf(plugin.name)
                if (!watching.signal.aborted && String(familiars) !== told) {
                  told = String(familiars)
                  listener(familiars)
                }
              })
              // Closed storage has nothing more to tell, and the listener
              // handles its own errors.
              .catch(() => {})
          }
          changes.addEventListener('change', update, {
            signal: watching.signal,
          })
          update()
          firsts.push(reading)
        },
      })
      if (closePlugin) {
        closes.push(closePlugin)
      }
      await Promise.all(firsts)
    }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
  return close
}
