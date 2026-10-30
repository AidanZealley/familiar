import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { signIn, uninstall, update } from './manage.ts'
import { resolvePaths } from './paths.ts'
import { openService } from './service/index.ts'
import { readSettings } from './settings.ts'
import { signIn as login } from './sign-in.ts'
import { unpublish } from './tailnet.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('./paths.ts', () => ({ resolvePaths: vi.fn() }))
vi.mock('./service/index.ts', () => ({ openService: vi.fn() }))
vi.mock('./settings.ts', () => ({ readSettings: vi.fn() }))
vi.mock('./sign-in.ts', () => ({ signIn: vi.fn() }))
vi.mock('./tailnet.ts', () => ({ unpublish: vi.fn() }))
const remove = vi.fn()
const withStopped = vi.fn(async (run: () => Promise<void>) => run())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(resolvePaths).mockReturnValue({
    cliPath: '/custom/lib/node_modules/familiar/familiar.js',
    dataDir: '/private/data',
    webDir: '/web',
    workDir: '/app',
  })
  vi.mocked(openService).mockReturnValue({
    uninstall: remove,
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
  expect(execFileSync).toHaveBeenCalledWith(
    'npm',
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
  expect(execFileSync).not.toHaveBeenCalled()
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
