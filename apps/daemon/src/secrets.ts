import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { SecretStore } from '@familiar/core'

type SecretsFile = Record<string, Record<string, Record<string, string>>>

/**
 * Plugins' secrets in one JSON file, nested by kind, name and secret, kept in
 * memory and rewritten atomically on change. Writes are synchronous and one
 * process owns the file, so they can't interleave.
 */
export function fileSecretStore(path: string): SecretStore {
  const secrets: SecretsFile = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {}

  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(secrets, null, 2), {
      mode: 0o600,
    })
    renameSync(`${path}.tmp`, path)
  }

  return {
    get: async ({ kind, name }, secret) => secrets[kind]?.[name]?.[secret],
    set: async ({ kind, name }, secret, value) => {
      secrets[kind] ??= {}
      secrets[kind][name] ??= {}
      secrets[kind][name][secret] = value
      save()
    },
    delete: async ({ kind, name }, secret) => {
      const owned = secrets[kind]?.[name]
      if (owned?.[secret] === undefined) {
        return
      }
      delete owned[secret]
      if (Object.keys(owned).length === 0) {
        delete secrets[kind][name]
      }
      save()
    },
  }
}
