import type { Credential, CredentialStore } from '../models/index.ts'
import { jsonFile } from './json-file.ts'

/**
 * Credentials in one JSON file (pi's auth.json shape). pi-ai refreshes OAuth
 * tokens through `modify`, so a rotated token is saved before it is used.
 * `modify` awaits the refresh, so changes queue to keep one refresh from
 * overwriting another.
 */
export function fileCredentialStore(path: string): CredentialStore {
  const file = jsonFile<Record<string, Credential>>(path, () => ({}))
  const credentials = file.value
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
    read: async (providerId) => credentials[providerId],
    list: async () =>
      Object.entries(credentials).map(([providerId, { type }]) => ({
        providerId,
        type,
      })),
    modify: (providerId, fn) =>
      serialized(async () => {
        const next = await fn(credentials[providerId])
        if (next !== undefined) {
          credentials[providerId] = next
          file.save()
        }
        return credentials[providerId]
      }),
    delete: (providerId) =>
      serialized(async () => {
        delete credentials[providerId]
        file.save()
      }),
  }
}
