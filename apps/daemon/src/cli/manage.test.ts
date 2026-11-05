import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { rename, signIn, status, uninstall, update } from './manage.ts'
import { ensureDataDir, resolvePaths } from '../paths.ts'
import { runNpm } from './npm.ts'
import { openService } from './service/index.ts'
import { readSettings, saveSettings } from '../settings.ts'
import { signIn as login } from './sign-in.ts'
import { publishedUrl, unpublish } from './tailnet.ts'

vi.mock('./npm.ts', () => ({ runNpm: vi.fn() }))
vi.mock('../paths.ts', () => ({
  ensureDataDir: vi.fn(),
  resolvePaths: vi.fn(),
}))
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
vi.mock('./service/index.ts', () => ({ openService: vi.fn() }))
vi.mock('../settings.ts', () => ({
  readSettings: vi.fn(),
  saveSettings: vi.fn(),
}))
vi.mock('./sign-in.ts', () => ({ signIn: vi.fn() }))
vi.mock('./tailnet.ts', () => ({ publishedUrl: vi.fn(), unpublish: vi.fn() }))
const remove = vi.fn()
const isRunning = vi.fn()
const restart = vi.fn()
const terminal = { question: vi.fn(), close: vi.fn() }
const withStopped = vi.fn(async (run: () => Promise<void>) => run())
beforeEach(() => {
  vi.clearAllMocks()
  isRunning.mockReturnValue(true)
  vi.mocked(publishedUrl).mockReturnValue(
    'https://machine.example.ts.net:10000',
  )
  terminal.question.mockResolvedValue('Scout')
  vi.mocked(createInterface).mockReturnValue(terminal as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(resolvePaths).mockReturnValue({
    cliPath: resolve(
      '/custom',
      process.platform === 'win32'
        ? 'node_modules/familiar/familiar.js'
        : 'lib/node_modules/familiar/familiar.js',
    ),
    dataDir: '/private/data',
    webDir: '/web',
    workDir: '/app',
  })
  vi.mocked(openService).mockReturnValue({
    uninstall: remove,
    isRunning,
    restart,
    withStopped,
  } as never)
  vi.mocked(readSettings).mockReturnValue({
    explicit: {},
    name: 'Familiar',
    owner: 'owner',
    port: 4325,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

test('update targets this installation prefix while the service is suspended', async () => {
  await update()
  expect(withStopped).toHaveBeenCalledOnce()
  expect(runNpm).toHaveBeenCalledWith(
    [
      'install',
      '--global',
      '--prefix',
      resolve('/custom'),
      'https://github.com/AidanZealley/familiar/releases/latest/download/familiar.tgz',
    ],
    { stdio: 'inherit' },
  )
})

test('source checkouts cannot accidentally install a second copy through update', async () => {
  vi.mocked(resolvePaths).mockReturnValue({
    cliPath: '/repo/apps/daemon/src/cli.ts',
    dataDir: '/private',
    webDir: '/web',
    workDir: '/app',
  })
  await expect(update()).rejects.toThrow('source checkout')
  expect(runNpm).not.toHaveBeenCalled()
})

test('uninstall removes the service and matching publication while preserving data', () => {
  uninstall()
  expect(remove).toHaveBeenCalledOnce()
  expect(unpublish).toHaveBeenCalledWith(4325)
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('Your data remains in /private/data'),
  )
})

test('explicit sign-in suspends the daemon to avoid competing credential writers', async () => {
  await signIn()
  expect(withStopped).toHaveBeenCalledOnce()
  expect(login).toHaveBeenCalledOnce()
})

test('status reports the saved name, matching service and existing URLs without changing anything', () => {
  status()
  expect(readSettings).toHaveBeenCalledWith('/private/data', {})
  expect(console.log).toHaveBeenCalledWith(
    'Tailnet: https://machine.example.ts.net:10000',
  )
  expect(ensureDataDir).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()
  expect(restart).not.toHaveBeenCalled()
})

test('rename saves only the name and restarts the service only if it was running', async () => {
  vi.mocked(readSettings).mockReturnValue({
    ...readSettings('/private/data', {}),
    explicit: { name: 'Familiar', model: 'chosen-model', port: 4325 },
  })
  await rename('Willow')
  expect(saveSettings).toHaveBeenLastCalledWith('/private/data', {
    name: 'Willow',
    model: 'chosen-model',
    port: 4325,
  })
  expect(restart).toHaveBeenCalledOnce()
  isRunning.mockReturnValue(false)
  await rename('Wren')
  expect(restart).toHaveBeenCalledOnce()
})

test('rename asks for a name, keeps the old one on an empty reply, and refuses a blank one', async () => {
  await rename()
  expect(terminal.question).toHaveBeenCalledWith('New name [Familiar]: ')
  expect(saveSettings).toHaveBeenCalledWith('/private/data', { name: 'Scout' })
  vi.mocked(saveSettings).mockClear()
  terminal.question.mockResolvedValue('')
  await rename()
  await expect(rename('  ')).rejects.toThrow('must not be empty')
  expect(saveSettings).not.toHaveBeenCalled()
  expect(restart).toHaveBeenCalledOnce()
})
