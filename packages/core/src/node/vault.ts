import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

/** Load a private 256-bit key, creating it only when no protected files exist. */
export function fileVaultKey(
  path: string,
  protectedFiles: readonly string[] = [],
): Buffer {
  if (!existsSync(path)) {
    if (protectedFiles.some((file) => existsSync(file))) {
      throw new Error(
        'Vault key is missing. Restore it before opening existing credentials.',
      )
    }
    try {
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
  const key = readFileSync(path)
  if (key.length !== 32) {
    throw new Error('Vault key must contain exactly 32 bytes.')
  }
  return key
}

/**
 * A whole encrypted JSON document, authenticated for its purpose. The host
 * owns the directory and its writer lock. No plaintext is written to disk.
 */
export function encryptedJsonFile<T>(
  path: string,
  key: Uint8Array,
  purpose: string,
  initial: () => T,
) {
  if (key.byteLength !== 32) {
    throw new Error('Vault key must contain exactly 32 bytes.')
  }
  const vaultKey = Buffer.from(key)
  const binding = Buffer.from(JSON.stringify(['familiar-vault', 1, purpose]))
  const read = (): T => {
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8'))
      if (envelope.version !== 1 || typeof envelope.sealed !== 'string') {
        throw new Error()
      }
      const bytes = Buffer.from(envelope.sealed, 'base64')
      if (bytes.length < 28) {
        throw new Error()
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        vaultKey,
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
      throw new Error(
        `Cannot open encrypted vault file ${path}. Check its key and contents.`,
      )
    }
  }
  const file: { value: T; save(value?: T): void } = {
    value: existsSync(path) ? read() : initial(),
    save(value: T = file.value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', vaultKey, nonce)
      cipher.setAAD(binding)
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ])
      const sealed = Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        ciphertext,
      ]).toString('base64')
      // Exclusive creation avoids reusing an old temporary file with loose permissions.
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify({ version: 1, sealed }), {
          mode: 0o600,
          flag: 'wx',
        })
        renameSync(temporary, path)
      } finally {
        if (existsSync(temporary)) {
          unlinkSync(temporary)
        }
      }
      file.value = value
    },
  }
  if (!existsSync(path)) {
    file.save()
  }
  return file
}
