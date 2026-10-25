import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'

/**
 * Credentials in one JSON file (pi's auth.json shape), kept in memory and
 * rewritten atomically on change. pi-ai refreshes OAuth tokens through
 * `modify`, so a rotated token is saved before it is used.
 *
 * One process owns the file, so serializing writes in memory is enough.
 */
export function fileCredentialStore(path: string): CredentialStore {
  const credentials: Record<string, Credential> = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {}
  let queue = Promise.resolve()

  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    })
    renameSync(`${path}.tmp`, path)
  }

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
          save()
        }
        return credentials[providerId]
      }),
    delete: (providerId) =>
      serialized(async () => {
        delete credentials[providerId]
        save()
      }),
  }
}
