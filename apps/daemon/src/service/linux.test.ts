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
import { linuxService, renderUnit } from './linux.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
let temporary: string
let running: boolean
const calls = () =>
  vi
    .mocked(execFileSync)
    .mock.calls.map(([command, args]) => [command, ...(args ?? [])].join(' '))
const service = () =>
  linuxService({
    dataDir: resolve(temporary, 'data'),
    cliPath: resolve(temporary, 'app/familiar.js'),
    unitDir: temporary,
  })
beforeEach(() => {
  temporary = mkdtempSync(resolve(tmpdir(), 'familiar-service-'))
  running = false
  vi.stubEnv('XDG_DATA_HOME', resolve(temporary, 'xdg'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(execFileSync)
    .mockReset()
    .mockImplementation((_command, args) => {
      if (args?.includes('is-active') && !running) {
        throw Object.assign(new Error('inactive'), { status: 3 })
      }
      if (args?.includes('restart') || args?.includes('start')) {
        running = true
      }
      if (args?.includes('stop')) {
        running = false
      }
      return 'yes\n' as never
    })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(temporary, { recursive: true, force: true })
})

test('the unit pins the CLI, private storage and loopback, escaping systemd specifiers', () => {
  const unit = renderUnit({
    dataDir: '/data/50%/$owner',
    cliPath: '/app with spaces/familiar.js',
    node: '/node/$version/node',
  })
  expect(unit).toContain(
    'ExecStart=:"/node/$version/node" "/app with spaces/familiar.js" serve',
  )
  expect(unit).toContain('Environment="FAMILIAR_DATA_DIR=/data/50%%/$owner"')
  expect(unit).toContain('Environment=FAMILIAR_HOST=127.0.0.1')
})

test('install writes and starts once, and repeat setup leaves the unit and process alone', () => {
  const host = service()
  host.install()
  const unit = resolve(temporary, 'familiar.service')
  const modified = statSync(unit).mtimeMs
  expect(readFileSync(unit, 'utf8')).toContain('familiar.js" serve')
  expect(calls()).toContain('systemctl --user daemon-reload')
  vi.mocked(execFileSync).mockClear()
  host.install()
  expect(statSync(unit).mtimeMs).toBe(modified)
  expect(calls().some((call) => /restart|daemon-reload/.test(call))).toBe(false)
  running = false
  host.install()
  expect(calls()).toContain('systemctl --user start familiar')
})

test('changed settings restart an otherwise unchanged service', () => {
  const host = service()
  host.install()
  vi.mocked(execFileSync).mockClear()
  host.install(true)
  expect(calls()).toContain('systemctl --user restart familiar')
})

test('temporary work stops and resumes an active daemon even after failure', async () => {
  service().install()
  vi.mocked(execFileSync).mockClear()
  await expect(
    service().withStopped(async () => {
      expect(running).toBe(false)
      throw new Error('login cancelled')
    }),
  ).rejects.toThrow('login cancelled')
  expect(running).toBe(true)
  expect(calls()).toEqual([
    'systemctl --user is-active --quiet familiar',
    'systemctl --user stop familiar',
    'systemctl --user restart familiar',
  ])
})

test('removal disables the service without removing its data directory', () => {
  const host = service()
  host.install()
  host.uninstall()
  expect(calls()).toContain('systemctl --user disable --now familiar')
  expect(existsSync(resolve(temporary, 'familiar.service'))).toBe(false)
  vi.mocked(execFileSync).mockClear()
  host.uninstall()
  expect(calls()).toEqual([])
})

test('a refused linger change prints the command needed for logged-out operation', () => {
  vi.mocked(execFileSync).mockImplementation((command) => {
    if (command === 'loginctl') {
      throw new Error('permission denied')
    }
    return '' as never
  })
  service().install()
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('sudo loginctl enable-linger'),
  )
})

test('an unavailable systemd user bus is an error rather than an inactive service', () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw Object.assign(new Error('no bus'), { status: 1 })
  })
  expect(() => service().isRunning()).toThrow('no bus')
})

test('login for another data directory does not stop this service', async () => {
  service().install()
  vi.mocked(execFileSync).mockClear()
  const other = linuxService({
    dataDir: resolve(temporary, 'other'),
    cliPath: '/app/familiar.js',
    unitDir: temporary,
  })
  await other.withStopped(async () => {
    expect(running).toBe(true)
  })
  expect(calls()).toEqual([])
  expect(() => other.install()).toThrow('different data directory')
  expect(() => other.uninstall()).toThrow('different data directory')
})

test('an old service unit is not silently moved to another data directory', () => {
  writeFileSync(
    resolve(temporary, 'familiar.service'),
    '[Service]\nExecStart=/usr/bin/node /old/main.ts\n',
  )
  expect(() => service().install()).toThrow('different data directory')
  expect(calls()).toEqual([])
})

test('legacy default-directory services are paused for login without requiring a setup loop', async () => {
  writeFileSync(
    resolve(temporary, 'familiar.service'),
    '[Service]\nExecStart=/usr/bin/node /old/main.ts\n',
  )
  const host = linuxService({
    dataDir: resolve(temporary, 'xdg/familiar'),
    cliPath: '/app/familiar.js',
    unitDir: temporary,
  })
  running = true
  await host.withStopped(async () => {
    expect(running).toBe(false)
  })
  expect(running).toBe(true)
  expect(calls()).toContain('systemctl --user stop familiar')
})
