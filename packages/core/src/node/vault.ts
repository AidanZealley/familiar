import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

/**
 * A JSON document encrypted at rest with AES-256-GCM, under a 32-byte key in
 * its own file. Several files can share a key; each is bound to its `purpose`,
 * so one can't stand in for another.
 *
 * The key is created on the first write, never while an encrypted file needs
 * it. A plaintext file from before encryption is read once and re-saved
 * encrypted. Like `jsonFile`, it assumes one writer: lock the directory first.
 */
export function encryptedJsonFile<T>(
  path: string,
  keyPath: string,
  purpose: string,
  initial: () => T,
) {
  const binding = Buffer.from(`familiar-vault:1:${purpose}`)

  const file = {
    value: initial(),
    /** Publishes `value` only once it is safely on disk. */
    save(value: T) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', writingKey(keyPath), nonce)
      cipher.setAAD(binding)
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ])
      const sealed = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
      writeAtomically(
        path,
        JSON.stringify({ version: 1, sealed: sealed.toString('base64') }),
      )
      file.value = value
    },
  }

  if (existsSync(path)) {
    const stored = parse()
    if (typeof stored === 'object' && stored !== null && 'sealed' in stored) {
      file.value = unseal(stored)
    } else {
      // Plaintext from before encryption.
      file.save(stored as T)
    }
  }
  return file

  function parse(): unknown {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      throw unreadable()
    }
  }

  function unseal({
    version,
    sealed,
  }: {
    version?: unknown
    sealed: unknown
  }): T {
    const key = existingKey(keyPath, path)
    try {
      if (version !== 1 || typeof sealed !== 'string') {
        throw new Error('Unknown format')
      }
      const bytes = Buffer.from(sealed, 'base64')
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12),
      )
      decipher.setAAD(binding)
      decipher.setAuthTag(bytes.subarray(12, 28))
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ])
      return JSON.parse(plaintext.toString('utf8')) as T
    } catch {
      throw unreadable()
    }
  }

  function unreadable() {
    return new Error(
      `Can't decrypt ${path} with ${keyPath}: the key isn't the one it was saved with, or the file is damaged. Restore both from the same backup, or delete ${path} and enter its credentials again.`,
    )
  }
}

/** The key an encrypted file was saved with, which must already exist. */
function existingKey(keyPath: string, path: string) {
  if (!existsSync(keyPath)) {
    throw new Error(
      `${path} is encrypted, but its key ${keyPath} is missing. Restore the key from the backup you made with this file. If it's lost, delete ${path} and enter its credentials again.`,
    )
  }
  return validKey(keyPath)
}

/** The key to save with, created on first use. */
function writingKey(keyPath: string) {
  try {
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  return validKey(keyPath)
}

function validKey(keyPath: string) {
  const key = readFileSync(keyPath)
  if (key.length !== 32) {
    throw new Error(
      `${keyPath} isn't a vault key: it must be exactly 32 bytes. Restore it from a backup.`,
    )
  }
  return key
}

/** A crash leaves the old file or the new one; a fresh name keeps it private. */
function writeAtomically(path: string, contents: string) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary)
    }
  }
}
