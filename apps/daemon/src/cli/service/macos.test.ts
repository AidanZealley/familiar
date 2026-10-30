import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { macosService, renderAgent } from './macos.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
let temporary: string
let loaded: boolean
const file = () => resolve(temporary, 'com.familiar.daemon.plist')
const service = (dataDir = resolve(temporary, 'data')) =>
  macosService({
    dataDir,
    cliPath: resolve(temporary, 'app/familiar.js'),
    agentDir: temporary,
    uid: 501,
  })
const calls = () =>
  vi
    .mocked(execFileSync)
    .mock.calls.map(([command, args]) => [command, ...(args ?? [])].join(' '))
beforeEach(() => {
  temporary = mkdtempSync(resolve(tmpdir(), 'familiar-launchagent-'))
  loaded = false
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(execFileSync)
    .mockReset()
    .mockImplementation((_command, args) => {
      if (args?.[0] === 'print') {
        if (!loaded) {
          throw Object.assign(new Error('missing service'), { status: 113 })
        }
        return 'state = running\n  pid = 123\n' as never
      }
      if (args?.[0] === 'bootout') {
        loaded = false
      }
      if (args?.[0] === 'bootstrap') {
        loaded = true
      }
      return '' as never
    })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(temporary, { recursive: true, force: true })
})

test('the LaunchAgent uses explicit arguments, private storage, loopback and escaped XML', () => {
  const content = renderAgent({
    dataDir: '/data/Owner & Cat',
    cliPath: '/app with spaces/familiar.js',
    node: '/private/node',
    path: '/usr/bin:/bin',
  })
  expect(content).toContain('<string>/app with spaces/familiar.js</string>')
  expect(content).toContain('<string>/data/Owner &amp; Cat</string>')
  expect(content).toContain('<key>KeepAlive</key><true/>')
  expect(content).toContain(
    '<key>FAMILIAR_HOST</key><string>127.0.0.1</string>',
  )
  expect(content).toContain(
    '<key>PATH</key><string>/private:/usr/bin:/bin</string>',
  )
})

test('install loads once and repeat setup leaves a running agent alone', () => {
  const host = service()
  host.install()
  expect(host.isRunning()).toBe(true)
  const modified = statSync(file()).mtimeMs
  vi.mocked(execFileSync).mockClear()
  host.install()
  expect(statSync(file()).mtimeMs).toBe(modified)
  expect(calls().some((call) => /bootstrap|bootout/.test(call))).toBe(false)
})

test('suspension unloads KeepAlive and restores the agent after failed work', async () => {
  const host = service()
  host.install()
  await expect(
    host.withStopped(async () => {
      expect(loaded).toBe(false)
      throw new Error('cancelled')
    }),
  ).rejects.toThrow('cancelled')
  expect(loaded).toBe(true)
})

test('a different data directory cannot replace or unload this agent', async () => {
  service().install()
  vi.mocked(execFileSync).mockClear()
  const other = service(resolve(temporary, 'other'))
  expect(other.isRunning()).toBe(false)
  await other.withStopped(async () => {
    expect(loaded).toBe(true)
  })
  expect(() => other.install()).toThrow('different data directory')
  expect(() => other.uninstall()).toThrow('different data directory')
  expect(calls()).toEqual([])
})

test('uninstall removes only the agent definition and preserves stored files', () => {
  const host = service()
  host.install()
  const data = resolve(temporary, 'data/familiar.sqlite')
  writeFileSync(data, 'conversation fixture')
  host.uninstall()
  expect(loaded).toBe(false)
  expect(existsSync(file())).toBe(false)
  expect(readFileSync(data, 'utf8')).toBe('conversation fixture')
})
