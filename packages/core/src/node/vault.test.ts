import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
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

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

/** A fresh data directory with the daemon's file names. */
function dataDir() {
  const root = mkdtempSync(join(tmpdir(), 'familiar-vault-'))
  directories.push(root)
  return {
    root,
    secrets: join(root, 'secrets.json'),
    auth: join(root, 'auth.json'),
    key: join(root, 'vault.key'),
  }
}

const connection = { kind: 'mcp', name: 'home' } as const

test('secrets are encrypted and private on disk, and survive reopening', async () => {
  const dir = dataDir()
  const store = fileSecretStore(dir.secrets, dir.key)
  expect(existsSync(dir.key)).toBe(false)
  await store.set(connection, 'token', 'private-token')
  expect(readFileSync(dir.secrets, 'utf8')).not.toContain('private-token')
  if (process.platform !== 'win32') {
    expect(statSync(dir.secrets).mode & 0o777).toBe(0o600)
    expect(statSync(dir.key).mode & 0o777).toBe(0o600)
  }
  const reopened = fileSecretStore(dir.secrets, dir.key)
  expect(await reopened.get(connection, 'token')).toBe('private-token')
  await reopened.delete(connection, 'token')
  expect(
    await fileSecretStore(dir.secrets, dir.key).get(connection, 'token'),
  ).toBeUndefined()
})

test('plaintext files are encrypted in place', async () => {
  const dir = dataDir()
  writeFileSync(
    dir.secrets,
    JSON.stringify({ mcp: { home: { token: 'old-token' } } }),
  )
  const login = { type: 'api_key', key: 'old-key' } as const
  writeFileSync(dir.auth, JSON.stringify({ openai: login }))
  const secrets = fileSecretStore(dir.secrets, dir.key)
  const credentials = fileCredentialStore(dir.auth, dir.key)
  expect(readFileSync(dir.secrets, 'utf8')).not.toContain('old-token')
  expect(readFileSync(dir.auth, 'utf8')).not.toContain('old-key')
  expect(await secrets.get(connection, 'token')).toBe('old-token')
  expect(await credentials.read('openai')).toEqual(login)
  expect(await fileCredentialStore(dir.auth, dir.key).read('openai')).toEqual(
    login,
  )
})

test('a missing, wrong or swapped key, or a damaged file, is refused without changing anything', async () => {
  const dir = dataDir()
  await fileSecretStore(dir.secrets, dir.key).set(connection, 'token', 'x')
  const sealed = readFileSync(dir.secrets, 'utf8')
  const key = readFileSync(dir.key)

  // Another file can't stand in for this one under the same key.
  expect(() => fileCredentialStore(dir.secrets, dir.key)).toThrow(
    "Can't decrypt",
  )

  writeFileSync(dir.key, Buffer.alloc(32))
  expect(() => fileSecretStore(dir.secrets, dir.key)).toThrow("Can't decrypt")

  unlinkSync(dir.key)
  expect(() => fileSecretStore(dir.secrets, dir.key)).toThrow('is missing')
  expect(existsSync(dir.key)).toBe(false)

  writeFileSync(dir.key, key)
  const envelope = JSON.parse(sealed)
  const bytes = Buffer.from(envelope.sealed, 'base64')
  bytes[bytes.length - 1] ^= 1
  const damaged = JSON.stringify({
    ...envelope,
    sealed: bytes.toString('base64'),
  })
  writeFileSync(dir.secrets, damaged)
  expect(() => fileSecretStore(dir.secrets, dir.key)).toThrow("Can't decrypt")
  expect(readFileSync(dir.secrets, 'utf8')).toBe(damaged)
})

test('provider refreshes queue, and a failed one changes nothing', async () => {
  const dir = dataDir()
  const store = fileCredentialStore(dir.auth, dir.key)
  await store.modify('test', async () => ({ type: 'api_key', key: 'v0' }))
  const refresh = () =>
    store.modify('test', async (current) => {
      if (current?.type !== 'api_key') {
        throw new Error('Missing key')
      }
      await Promise.resolve()
      return { type: 'api_key', key: `${current.key}+` }
    })
  await Promise.all([refresh(), refresh()])

  await expect(
    store.modify('test', async (current) => {
      if (current?.type === 'api_key') {
        current.key = 'half-refreshed'
      }
      throw new Error('Refresh failed')
    }),
  ).rejects.toThrow('Refresh failed')

  const expected = { type: 'api_key', key: 'v0++' }
  expect(await store.read('test')).toEqual(expected)
  expect(await fileCredentialStore(dir.auth, dir.key).read('test')).toEqual(
    expected,
  )
})

test("a value that couldn't be saved isn't served", async () => {
  const dir = dataDir()
  const store = fileSecretStore(dir.secrets, dir.key)
  await store.set(connection, 'token', 'saved')
  // A directory in the file's place makes the next save fail.
  const aside = join(dir.root, 'aside.json')
  renameSync(dir.secrets, aside)
  mkdirSync(dir.secrets)
  await expect(store.set(connection, 'token', 'unsaved')).rejects.toThrow()
  expect(await store.get(connection, 'token')).toBe('saved')
})
