import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * A private JSON file this process owns: read once, then rewritten whole by
 * `save`. Writing a temporary file and renaming it means a crash leaves the
 * old file or the new one, never half of either. Claim its directory with
 * `lockDataDir` so no other process writes it meanwhile.
 *
 * Without a path, the value lives only in memory.
 */
export function jsonFile<T>(path: string | undefined, initial: () => T) {
  const file = {
    value: (path && existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : initial()) as T,
    save() {
      if (path) {
        writeFileSync(`${path}.tmp`, JSON.stringify(file.value, null, 2), {
          mode: 0o600,
        })
        renameSync(`${path}.tmp`, path)
      }
    },
  }
  return file
}
