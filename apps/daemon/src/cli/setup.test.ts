import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openModels } from '../models.ts'
import { openService } from './service/index.ts'
import { setup } from './setup.ts'
import { signIn } from './sign-in.ts'
import { publish } from './tailnet.ts'

vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
vi.mock('../models.ts', () => ({ openModels: vi.fn() }))
vi.mock('./service/index.ts', () => ({ openService: vi.fn() }))
vi.mock('./sign-in.ts', () => ({ signIn: vi.fn() }))
vi.mock('./tailnet.ts', () => ({ publish: vi.fn() }))
let temporary: string
const checkAuth = vi.fn()
const install = vi.fn()
const withStopped = vi.fn(async (run: () => Promise<void>) => run())
const terminal = { question: vi.fn(), close: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]')),
  )
  temporary = mkdtempSync(resolve(tmpdir(), 'familiar-setup-'))
  vi.stubEnv('FAMILIAR_DATA_DIR', resolve(temporary, 'private'))
  vi.stubEnv('FAMILIAR_HOST', '127.0.0.1')
  for (const key of [
    'FAMILIAR_NAME',
    'FAMILIAR_OWNER',
    'FAMILIAR_MODEL',
    'FAMILIAR_PORT',
  ]) {
    vi.stubEnv(key, undefined)
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  terminal.question.mockResolvedValue('Willow')
  vi.mocked(createInterface).mockReturnValue(terminal as never)
  vi.mocked(openModels).mockReturnValue({ checkAuth } as never)
  vi.mocked(openService).mockReturnValue({ install, withStopped } as never)
  checkAuth.mockResolvedValue(undefined)
  vi.mocked(signIn).mockResolvedValue(undefined)
  vi.mocked(publish).mockReturnValue('https://machine.example.ts.net:10000')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(temporary, { recursive: true, force: true })
})

test('first setup saves private settings, signs in, installs the service and prints its URLs', async () => {
  await setup()
  const path = resolve(temporary, 'private/settings.json')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    name: 'Willow',
  })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(resolve(temporary, 'private')).mode & 0o777).toBe(0o700)
  expect(signIn).toHaveBeenCalledOnce()
  expect(withStopped).toHaveBeenCalledOnce()
  expect(install).toHaveBeenCalledWith(true)
  expect(publish).toHaveBeenCalledWith(4317)
  expect(console.log).toHaveBeenCalledWith(
    'Open Familiar: http://127.0.0.1:4317',
  )
  expect(console.log).toHaveBeenCalledWith(
    'On your tailnet: https://machine.example.ts.net:10000',
  )
})

test('repeat setup keeps settings and login, without prompting or forcing a restart', async () => {
  await setup()
  const path = resolve(temporary, 'private/settings.json')
  const modified = statSync(path).mtimeMs
  vi.clearAllMocks()
  checkAuth.mockResolvedValue({ type: 'oauth' })
  await setup()
  expect(terminal.question).not.toHaveBeenCalled()
  expect(signIn).not.toHaveBeenCalled()
  expect(withStopped).not.toHaveBeenCalled()
  expect(statSync(path).mtimeMs).toBe(modified)
  expect(install).toHaveBeenCalledWith(false)
})

test('environment overrides are persisted for the service, and use its actual port', async () => {
  vi.stubEnv('FAMILIAR_PORT', '4325')
  terminal.question.mockResolvedValue('')
  checkAuth.mockResolvedValue({ type: 'oauth' })
  await setup()
  expect(publish).toHaveBeenCalledWith(4325)
  expect(
    JSON.parse(
      readFileSync(resolve(temporary, 'private/settings.json'), 'utf8'),
    ).port,
  ).toBe(4325)
})

test('a cancelled login leaves resumable settings and does not install the service', async () => {
  vi.mocked(signIn).mockRejectedValue(new Error('cancelled'))
  await expect(setup()).rejects.toThrow('cancelled')
  expect(install).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
  expect(terminal.close).toHaveBeenCalled()
})

test('setup refuses a public bind before writing settings or installing anything', async () => {
  vi.stubEnv('FAMILIAR_HOST', '0.0.0.0')
  await expect(setup()).rejects.toThrow('127.0.0.1')
  expect(existsSync(resolve(temporary, 'private'))).toBe(false)
  expect(install).not.toHaveBeenCalled()
})

test('setup waits for a starting daemon before publishing its URL', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('not listening yet'))
  await setup()
  expect(publish).toHaveBeenCalledOnce()
})

test('a failed daemon startup reports logs instead of claiming a working URL', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('not listening'))
  await expect(setup()).rejects.toThrow('familiar logs')
  expect(publish).not.toHaveBeenCalled()
  expect(console.log).not.toHaveBeenCalledWith(
    expect.stringContaining('Open Familiar:'),
  )
})
