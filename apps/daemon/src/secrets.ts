import type { SecretStore } from '@familiar-ai/core'
import { jsonFile } from './json-file.ts'

type SecretsFile = Record<string, Record<string, Record<string, string>>>

/** Plugins' and MCP servers' secrets in one JSON file, nested by kind, name and secret. */
export function fileSecretStore(path: string): SecretStore {
  const file = jsonFile<SecretsFile>(path, () => ({}))
  const secrets = file.value

  return {
    get: async ({ kind, name }, secret) => secrets[kind]?.[name]?.[secret],
    set: async ({ kind, name }, secret, value) => {
      secrets[kind] ??= {}
      secrets[kind][name] ??= {}
      secrets[kind][name][secret] = value
      file.save()
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
      file.save()
    },
  }
}
