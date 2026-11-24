import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
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
const packageDir = () =>
  resolve(
    root,
    process.platform === 'win32'
      ? 'node_modules/familiar'
      : 'lib/node_modules/familiar',
  )
const install = (version: string) =>
  writeFileSync(
    resolve(packageDir(), 'package.json'),
    JSON.stringify({ version }),
  )
const record = () =>
  JSON.parse(readFileSync(resolve(dataDir(), 'update.json'), 'utf8'))
const fetched = vi.fn()
/** The last package URL fetched, leaving out checks that the daemon answers. */
const downloaded = () =>
  fetched.mock.calls
    .map(([url]) => url as string)
    .filter((url) => !url.endsWith('/api/connections'))
    .at(-1)
// What the service is doing, in order, against when the download happened.
const events: string[] = []

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'familiar-update-'))
  mkdirSync(packageDir(), { recursive: true })
  mkdirSync(dataDir())
  install('0.4.3')
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
    isRunning: () => true,
    withStopped: async (work: () => Promise<void>) => {
      events.push('stop')
      try {
        await work()
      } finally {
        events.push('start')
      }
    },
  } as never)
  vi.mocked(runNpm).mockImplementation(() => {
    events.push('install')
    install('0.5.0')
    return ''
  })
  fetched.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/connections')) {
      events.push('answered')
      return new Response('[]')
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

test('downloads before stopping, installs into this prefix, and records the result', async () => {
  await update()
  expect(events).toEqual(['download', 'stop', 'install', 'start', 'answered'])
  expect(downloaded()).toBe(
    'https://github.com/AidanZealley/familiar/releases/latest/download/familiar.tgz',
  )
  expect(vi.mocked(runNpm).mock.lastCall?.[0]).toEqual([
    'install',
    '--global',
    '--prefix',
    root,
    resolve(dataDir(), 'update.tgz'),
  ])
  expect(record()).toMatchObject({
    source: 'release',
    from: '0.4.3',
    to: '0.5.0',
    phase: 'done',
  })
  expect(existsSync(resolve(dataDir(), 'update.tgz'))).toBe(false)
})

test('stays on the source its version names, unless told to switch', async () => {
  const url = downloaded
  install('0.4.3-main.168a762c')
  vi.mocked(runNpm).mockReturnValue('')
  await update()
  expect(url()).toMatch(/\/releases\/download\/main-build\/familiar\.tgz$/)
  await update('release')
  expect(url()).toMatch(/\/releases\/latest\/download\/familiar\.tgz$/)
  install('0.4.3')
  await update('main')
  expect(url()).toMatch(/\/releases\/download\/main-build\/familiar\.tgz$/)
})

test("a version that doesn't answer after starting is a failed update", async () => {
  const download = fetched.getMockImplementation()!
  fetched.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/connections')) {
      throw new Error('not listening')
    }
    return download(url)
  })
  await expect(update()).rejects.toThrow('did not answer after starting')
  expect(record()).toMatchObject({ phase: 'failed', to: '0.5.0' })
})

test('a failed download never stops the service', async () => {
  fetched.mockResolvedValue(new Response(null, { status: 404 }))
  await expect(update()).rejects.toThrow('404')
  expect(events).toEqual([])
  expect(record()).toMatchObject({ phase: 'failed', from: '0.4.3' })
})

test('a failed install restarts the old version and reads back with its log', async () => {
  vi.mocked(runNpm).mockImplementation(() => {
    writeFileSync(resolve(dataDir(), 'update.log'), 'npm error EACCES\n')
    throw new Error('npm failed (243)')
  })
  await expect(update()).rejects.toThrow('npm failed')
  expect(events).toEqual(['download', 'stop', 'start'])
  expect(lastUpdate(dataDir())).toMatchObject({
    phase: 'failed',
    error: 'npm failed (243)',
    log: 'npm error EACCES',
  })
})

test('one update at a time, and an abandoned one reads as interrupted', async () => {
  const lock = resolve(dataDir(), 'update.lock')
  writeFileSync(lock, String(process.ppid))
  await expect(update()).rejects.toThrow('already running')
  expect(events).toEqual([])

  writeFileSync(
    resolve(dataDir(), 'update.json'),
    JSON.stringify({ source: 'main', from: '0.4.3', phase: 'installing' }),
  )
  expect(lastUpdate(dataDir())?.phase).toBe('installing')
  rmSync(lock)
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
