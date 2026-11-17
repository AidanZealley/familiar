import type { SecretStore } from '../connections/index.ts'
import { encryptedJsonFile } from './vault.ts'

type SecretsFile = Record<string, Record<string, Record<string, string>>>

/** Plugins' and MCP servers' secrets in one encrypted JSON file, nested by kind, name and secret. */
export function fileSecretStore(path: string, key: Uint8Array): SecretStore {
  const file = encryptedJsonFile<SecretsFile>(
    path,
    key,
    'connection-secrets',
    () => ({}),
  )

  return {
    get: async ({ kind, name }, secret) => file.value[kind]?.[name]?.[secret],
    set: async ({ kind, name }, secret, value) => {
      const secrets = structuredClone(file.value)
      secrets[kind] ??= {}
      secrets[kind][name] ??= {}
      secrets[kind][name][secret] = value
      file.save(secrets)
    },
    delete: async ({ kind, name }, secret) => {
      const secrets = structuredClone(file.value)
      const owned = secrets[kind]?.[name]
      if (owned?.[secret] === undefined) {
        return
      }
      delete owned[secret]
      if (Object.keys(owned).length === 0) {
        delete secrets[kind][name]
      }
      file.save(secrets)
    },
  }
}
