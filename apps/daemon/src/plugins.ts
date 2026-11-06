import { existsSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FamiliarPlugin } from '@familiar-ai/core'

/**
 * The owner's plugins: each .ts or .js file directly in `dir`, default-
 * exporting one plugin. A file that fails to load is skipped and logged, so
 * one broken plugin never stops Familiar. They run in the daemon's process,
 * with its permissions, so only the owner adds them.
 */
export async function loadPlugins(dir: string) {
  if (!existsSync(dir)) {
    return []
  }
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(
      (file) => file.isFile() && ['.ts', '.js'].includes(extname(file.name)),
    )
    .map((file) => resolve(dir, file.name))
    .sort()
  const plugins: FamiliarPlugin[] = []
  for (const file of files) {
    try {
      const plugin = (await import(pathToFileURL(file).href)).default
      if (!plugin?.name || !Array.isArray(plugin.tools)) {
        throw new Error('Its default export must be a definePlugin(...).')
      }
      plugins.push(plugin)
    } catch (error) {
      console.error(
        `Skipped the plugin ${file}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return plugins
}
