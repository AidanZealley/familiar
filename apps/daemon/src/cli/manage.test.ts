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
    cliPath: '/custom/lib/node_modules/familiar/familiar.js',
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
    model: { provider: 'openai', modelId: 'test' },
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
      '/custom',
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
  expect(console.log).toHaveBeenCalledWith('Name: Familiar')
  expect(console.log).toHaveBeenCalledWith('Service: running')
  expect(console.log).toHaveBeenCalledWith('Local: http://127.0.0.1:4325')
  expect(console.log).toHaveBeenCalledWith(
    'Tailnet: https://machine.example.ts.net:10000',
  )
  expect(ensureDataDir).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()
  expect(restart).not.toHaveBeenCalled()
})

test('rename changes only the saved name and restarts a running matching service', async () => {
  const settings = readSettings('/private/data', {})
  settings.explicit = { name: 'Familiar', model: 'chosen-model', port: 4325 }
  await rename('Willow')
  expect(saveSettings).toHaveBeenCalledWith('/private/data', {
    name: 'Willow',
    model: 'chosen-model',
    port: 4325,
  })
  expect(restart).toHaveBeenCalledOnce()
  expect(terminal.question).not.toHaveBeenCalled()
})

test('interactive rename shows the existing name and saves the entered replacement', async () => {
  await rename()
  expect(terminal.question).toHaveBeenCalledWith('New name [Familiar]: ')
  expect(terminal.close).toHaveBeenCalled()
  expect(saveSettings).toHaveBeenCalledWith('/private/data', { name: 'Scout' })
})

test('renaming a stopped Familiar preserves its stopped state', async () => {
  isRunning.mockReturnValue(false)
  await rename('Willow')
  expect(saveSettings).toHaveBeenCalledWith('/private/data', { name: 'Willow' })
  expect(restart).not.toHaveBeenCalled()
})

test('an empty interactive response keeps the existing name without restarting', async () => {
  terminal.question.mockResolvedValue('')
  await rename()
  expect(saveSettings).not.toHaveBeenCalled()
  expect(restart).not.toHaveBeenCalled()
})

test('an explicit empty name is refused before changing settings or the service', async () => {
  await expect(rename('  ')).rejects.toThrow('must not be empty')
  expect(saveSettings).not.toHaveBeenCalled()
  expect(restart).not.toHaveBeenCalled()
})
