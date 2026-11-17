import { randomBytes } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { fileCredentialStore } from './credentials.ts'
import { fileSecretStore } from './secrets.ts'
import { encryptedJsonFile, fileVaultKey } from './vault.ts'

const directories: string[] = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'familiar-vault-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

test('connection secrets survive reopening without writing plaintext and delete durably', async () => {
  const root = directory()
  const path = join(root, 'secrets.json')
  const key = fileVaultKey(join(root, 'vault.key'), [path])
  const connection = { kind: 'mcp', name: 'home' } as const
  const store = fileSecretStore(path, key)
  await store.set(connection, 'token', 'private-token-value')
  expect(readFileSync(path, 'utf8')).not.toContain('private-token-value')
  const reopened = fileSecretStore(path, key)
  expect(await reopened.get(connection, 'token')).toBe('private-token-value')
  await reopened.delete(connection, 'token')
  expect(
    await fileSecretStore(path, key).get(connection, 'token'),
  ).toBeUndefined()
  if (process.platform !== 'win32') {
    expect(statSync(path).mode & 0o777).toBe(0o600)
  }
})

test('wrong keys, modified ciphertext and swapped purposes never overwrite existing data', () => {
  const root = directory()
  const path = join(root, 'secrets.json')
  const key = randomBytes(32)
  fileSecretStore(path, key)
  const original = readFileSync(path, 'utf8')
  expect(() => fileSecretStore(path, randomBytes(32))).toThrow('Cannot open')
  expect(() => fileCredentialStore(path, key)).toThrow('Cannot open')
  expect(readFileSync(path, 'utf8')).toBe(original)
  const envelope = JSON.parse(original)
  const bytes = Buffer.from(envelope.sealed, 'base64')
  bytes[bytes.length - 1] ^= 1
  writeFileSync(
    path,
    JSON.stringify({ ...envelope, sealed: bytes.toString('base64') }),
  )
  const damaged = readFileSync(path, 'utf8')
  expect(() => fileSecretStore(path, key)).toThrow('Cannot open')
  expect(readFileSync(path, 'utf8')).toBe(damaged)
})

test('a lost or invalid key is never replaced when protected data exists', () => {
  const root = directory()
  const path = join(root, 'secrets.json')
  const keyPath = join(root, 'vault.key')
  const key = fileVaultKey(keyPath, [path])
  fileSecretStore(path, key)
  expect(fileVaultKey(keyPath, [path])).toEqual(key)
  unlinkSync(keyPath)
  expect(() => fileVaultKey(keyPath, [path])).toThrow('missing')
  writeFileSync(keyPath, 'invalid')
  expect(() => fileVaultKey(keyPath, [path])).toThrow('32 bytes')
  expect(readFileSync(keyPath, 'utf8')).toBe('invalid')
})

test('plaintext files are refused without modification', () => {
  const path = join(directory(), 'auth.json')
  const plaintext = JSON.stringify({
    openai: { type: 'api_key', apiKey: 'existing-secret' },
  })
  writeFileSync(path, plaintext)
  expect(() => fileCredentialStore(path, randomBytes(32))).toThrow(
    'Cannot open',
  )
  expect(readFileSync(path, 'utf8')).toBe(plaintext)
})

test('provider refreshes serialize and persist before returning, and deletion survives reopening', async () => {
  const path = join(directory(), 'auth.json')
  const key = randomBytes(32)
  const store = fileCredentialStore(path, key)
  await store.modify('test', async () => ({ type: 'api_key', key: 'initial' }))
  const refresh = () =>
    store.modify('test', async (previous) => {
      if (previous?.type !== 'api_key') {
        throw new Error('Missing key')
      }
      await Promise.resolve()
      return { type: 'api_key', key: `${previous.key}-refreshed` }
    })
  await Promise.all([refresh(), refresh()])
  expect(await fileCredentialStore(path, key).read('test')).toEqual({
    type: 'api_key',
    key: 'initial-refreshed-refreshed',
  })
  expect(await store.list()).toEqual([{ providerId: 'test', type: 'api_key' }])
  expect(readFileSync(path, 'utf8')).not.toContain('initial')
  await store.delete('test')
  expect(await fileCredentialStore(path, key).read('test')).toBeUndefined()
})

test('generic vault values preserve Unicode and whitespace exactly and use fresh nonces', () => {
  const path = join(directory(), 'accounts.json')
  const key = randomBytes(32)
  const value = { password: '  密碼\n ' }
  const file = encryptedJsonFile(path, key, 'accounts', () => value)
  const first = readFileSync(path, 'utf8')
  file.save(value)
  expect(readFileSync(path, 'utf8')).not.toBe(first)
  expect(encryptedJsonFile(path, key, 'accounts', () => ({})).value).toEqual(
    value,
  )
})

test('OAuth refresh tokens persist, and a failed update leaves the stored credential unchanged', async () => {
  const path = join(directory(), 'auth.json')
  const key = randomBytes(32)
  const store = fileCredentialStore(path, key)
  const credential = {
    type: 'oauth' as const,
    access: 'access-token',
    refresh: 'refresh-token',
    expires: 123,
  }
  await store.modify('openai', async () => credential)
  await expect(
    store.modify('openai', async (current) => {
      if (current?.type !== 'oauth') {
        throw new Error('Missing OAuth credentials')
      }
      current.refresh = 'failed-refresh'
      throw new Error('Refresh failed')
    }),
  ).rejects.toThrow('Refresh failed')
  expect(await store.read('openai')).toEqual(credential)
  await store.modify('openai', async () => ({
    ...credential,
    refresh: 'rotated-token',
  }))
  expect(await fileCredentialStore(path, key).read('openai')).toEqual({
    ...credential,
    refresh: 'rotated-token',
  })
  expect(readFileSync(path, 'utf8')).not.toContain('rotated-token')
})

test('a failed file replacement does not publish a credential that was not persisted', async () => {
  const root = directory()
  const path = join(root, 'secrets.json')
  const previous = join(root, 'previous.json')
  const key = randomBytes(32)
  const connection = { kind: 'plugin', name: 'example' } as const
  const store = fileSecretStore(path, key)
  await store.set(connection, 'token', 'original')
  renameSync(path, previous)
  mkdirSync(path)
  await expect(store.set(connection, 'token', 'unsaved')).rejects.toThrow()
  expect(await store.get(connection, 'token')).toBe('original')
  rmSync(path, { recursive: true })
  renameSync(previous, path)
  expect(await fileSecretStore(path, key).get(connection, 'token')).toBe(
    'original',
  )
})
