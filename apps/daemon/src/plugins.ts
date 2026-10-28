import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FamiliarPlugin } from '@familiar/core'
import { webPlugin } from '@familiar/plugin-web'
import { createConverter } from './convert.ts'

/** Plugins every daemon installs. */
const firstParty: FamiliarPlugin[] = [webPlugin({ convert: createConverter() })]

/**
 * The daemon's plugins: the first-party ones, then any named in
 * FAMILIAR_PLUGINS (comma-separated package names or absolute paths, each
 * default-exporting a plugin). They run in the daemon's process, so only the
 * owner adds them.
 */
export async function loadPlugins(
  extra = process.env.FAMILIAR_PLUGINS ?? '',
): Promise<FamiliarPlugin[]> {
  const specifiers = extra
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
  const loaded = await Promise.all(
    specifiers.map(async (specifier) => {
      const module = await import(
        isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier
      )
      return module.default as FamiliarPlugin
    }),
  )
  return [...firstParty, ...loaded]
}
