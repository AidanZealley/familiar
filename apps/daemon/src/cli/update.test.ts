import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { takeLock } from '@familiar-ai/core/node'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolvePaths } from '../paths.ts'
import { runNpm } from './npm.ts'
import { openService } from './service/index.ts'
import { lastUpdate, update } from './update.ts'

vi.mock('./npm.ts', () => ({ runNpm: vi.fn() }))
vi.mock('../paths.ts', () => ({ resolvePaths: vi.fn() }))
vi.mock('./service/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service/index.ts')>()),
  openService: vi.fn(),
}))
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))

let root: string
const dataDir = () => resolve(root, 'data')
const modules =
  process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'
/** The package in the global npm prefix `prefix`. */
const packageDir = (prefix = root) => resolve(prefix, modules, 'familiar')
const staging = () => resolve(root, modules, '.familiar-next')
const install = (version: string, prefix = root) => {
  mkdirSync(packageDir(prefix), { recursive: true })
  writeFileSync(
    resolve(packageDir(prefix), 'package.json'),
    JSON.stringify({ version }),
  )
}
/** The version the live package is, as the daemon started from it says. */
const live = () =>
  JSON.parse(readFileSync(resolve(packageDir(), 'package.json'), 'utf8'))
    .version as string
/** The versions that answer once started. */
let starts: (version: string) => boolean
const record = () =>
  JSON.parse(readFileSync(resolve(dataDir(), 'update.json'), 'utf8'))
const fetched = vi.fn()
/** The last package URL fetched, leaving out checks that the daemon answers. */
const downloaded = () =>
  fetched.mock.calls
    .map(([url]) => url as string)
    .filter((url) => !url.endsWith('/api/update'))
    .at(-1)
// What the service is doing, in order, against when the download happened.
const events: string[] = []

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'familiar-update-'))
  mkdirSync(dataDir())
  install('0.4.3')
  starts = () => true
  vi.clearAllMocks()
  events.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(resolvePaths).mockReturnValue({
    cliPath: resolve(packageDir(), 'familiar.js'),
    dataDir: dataDir(),
    pluginsDir: '',
    avatarsDir: '',
    webDir: '',
  })
  vi.mocked(openService).mockReturnValue({
    isRegistered: () => true,
    stop: () => events.push('stop'),
    start: () => events.push('start'),
    install: () => events.push('register'),
  } as never)
  vi.mocked(runNpm).mockImplementation((args) => {
    events.push('install')
    install('0.5.0', args[3])
    return ''
  })
  // The daemon, running whatever version is live, if that one starts.
  fetched.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/update')) {
      if (!starts(live())) {
        throw new Error('not listening')
      }
      events.push(`answered ${live()}`)
      return Response.json({ installed: { version: live() } })
    }
    events.push('download')
    return new Response('package')
  })
  vi.stubGlobal('fetch', fetched)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

test('installs beside the running version, swaps it in, and records the result', async () => {
  await update()
  expect(events).toEqual([
    // Familiar runs until the new version is ready.
    'download',
    'install',
    'stop',
    // The new version's service registration replaces the old one's.
    'register',
    'answered 0.5.0',
  ])
  expect(downloaded()).toBe(
    'https://github.com/AidanZealley/familiar/releases/latest/download/familiar.tgz',
  )
  expect(vi.mocked(runNpm).mock.lastCall?.[0]).toEqual([
    'install',
    '--global',
    '--prefix',
    staging(),
    resolve(dataDir(), 'update.tgz'),
  ])
  expect(record()).toMatchObject({
    source: 'release',
    from: '0.4.3',
    to: '0.5.0',
    phase: 'done',
  })
  expect(live()).toBe('0.5.0')
  expect(readdirSync(resolve(root, modules))).toEqual(['familiar'])
  expect(existsSync(resolve(dataDir(), 'update.tgz'))).toBe(false)
})

test('stays on the source its version names, unless told to switch', async () => {
  const url = downloaded
  install('0.4.3-main.168a762c')
  await update()
  expect(url()).toMatch(/\/releases\/download\/main-build\/familiar\.tgz$/)
  await update('release')
  expect(url()).toMatch(/\/releases\/latest\/download\/familiar\.tgz$/)
  install('0.4.3')
  await update('main')
  expect(url()).toMatch(/\/releases\/download\/main-build\/familiar\.tgz$/)
})

test("a version that doesn't answer after starting is rolled back", async () => {
  starts = (version) => version !== '0.5.0'
  await expect(update()).rejects.toThrow(
    "0.5.0 didn't answer after starting, so Familiar went back to 0.4.3.",
  )
  expect(events).toEqual([
    'download',
    'install',
    'stop',
    'register',
    'stop',
    'start',
    'answered 0.4.3',
  ])
  expect(live()).toBe('0.4.3')
  expect(readdirSync(resolve(root, modules))).toEqual(['familiar'])
  expect(record()).toMatchObject({ phase: 'failed', to: '0.5.0' })
})

test('a failed download never stops the service', async () => {
  fetched.mockResolvedValue(new Response(null, { status: 404 }))
  await expect(update()).rejects.toThrow('404')
  expect(events).toEqual([])
  expect(record()).toMatchObject({ phase: 'failed', from: '0.4.3' })
})

test('a failed install never stops the service, and reads back with its log', async () => {
  vi.mocked(runNpm).mockImplementation(() => {
    writeFileSync(resolve(dataDir(), 'update.log'), 'npm error EACCES\n')
    throw new Error('npm failed (243)')
  })
  await expect(update()).rejects.toThrow('npm failed')
  expect(events).toEqual(['download'])
  expect(live()).toBe('0.4.3')
  expect(lastUpdate(dataDir())).toMatchObject({
    phase: 'failed',
    error: 'npm failed (243)',
    log: 'npm error EACCES',
  })
})

test('one update at a time, and an abandoned one reads as interrupted', async () => {
  const lock = takeLock(resolve(dataDir(), 'update.lock'))
  await expect(update()).rejects.toThrow('already running')
  expect(events).toEqual([])

  writeFileSync(
    resolve(dataDir(), 'update.json'),
    JSON.stringify({ source: 'main', from: '0.4.3', phase: 'installing' }),
  )
  expect(lastUpdate(dataDir())?.phase).toBe('installing')
  if (lock.taken) {
    lock.release()
  }
  expect(lastUpdate(dataDir())?.phase).toBe('interrupted')
})

test('source checkouts cannot install a second copy through update', async () => {
  vi.mocked(resolvePaths).mockReturnValue({
    cliPath: '/repo/apps/daemon/src/cli.ts',
    dataDir: dataDir(),
    pluginsDir: '',
    avatarsDir: '',
    webDir: '',
  })
  await expect(update()).rejects.toThrow('source checkout')
  expect(fetched).not.toHaveBeenCalled()
})
