import type { Credential, CredentialStore } from '../models/index.ts'
import { encryptedJsonFile } from './vault.ts'

/**
 * Credentials in one encrypted JSON file (pi's auth.json shape). pi-ai refreshes OAuth
 * tokens through `modify`, so a rotated token is saved before it is used.
 * `modify` awaits the refresh, so changes queue to keep one refresh from
 * overwriting another.
 */
export function fileCredentialStore(
  path: string,
  key: Uint8Array,
): CredentialStore {
  const file = encryptedJsonFile<Record<string, Credential>>(
    path,
    key,
    'provider-credentials',
    () => ({}),
  )
  let queue = Promise.resolve()

  const serialized = <T>(work: () => Promise<T>) => {
    const result = queue.then(work)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    read: async (providerId) => structuredClone(file.value[providerId]),
    list: async () =>
      Object.entries(file.value).map(([providerId, { type }]) => ({
        providerId,
        type,
      })),
    modify: (providerId, fn) =>
      serialized(async () => {
        const next = await fn(structuredClone(file.value[providerId]))
        if (next !== undefined) {
          file.save({ ...file.value, [providerId]: next })
        }
        return structuredClone(file.value[providerId])
      }),
    delete: (providerId) =>
      serialized(async () => {
        const next = { ...file.value }
        delete next[providerId]
        file.save(next)
      }),
  }
}
