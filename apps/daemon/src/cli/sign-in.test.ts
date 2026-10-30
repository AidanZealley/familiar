import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openModels } from '../models.ts'
import { signIn } from './sign-in.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
vi.mock('../config.ts', () => ({
  config: { name: 'Familiar', model: { provider: 'openai', modelId: 'test' } },
  deviceId: vi.fn(),
}))
vi.mock('../models.ts', () => ({ openModels: vi.fn() }))
const terminal = { question: vi.fn(), close: vi.fn() }
const login = vi.fn(
  async (_provider: string, _type: string, interaction: AuthInteraction) => {
    interaction.notify({ type: 'auth_url', url: 'https://example.com/login' })
    await interaction.prompt({ type: 'manual_code', message: 'Paste URL' })
  },
)
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('DISPLAY', '')
  vi.stubEnv('WAYLAND_DISPLAY', '')
  vi.mocked(openModels).mockReturnValue({
    login,
    getModel: () => ({ name: 'Test' }),
  } as never)
  vi.mocked(createInterface).mockReturnValue(terminal as never)
  vi.mocked(spawn).mockReturnValue({ on: vi.fn(), unref: vi.fn() } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('headless sign-in prints browser instructions without launching one', async () => {
  vi.stubEnv('SSH_CONNECTION', 'remote')
  await signIn()
  expect(spawn).not.toHaveBeenCalled()
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('paste the full URL'),
  )
  expect(terminal.close).toHaveBeenCalled()
})

test('desktop sign-in opens the browser and keeps the manual prompt available', async () => {
  vi.stubEnv('DISPLAY', ':0')
  await signIn()
  expect(spawn).toHaveBeenCalledWith(
    'xdg-open',
    ['https://example.com/login'],
    { detached: true, stdio: 'ignore' },
  )
  expect(terminal.question).toHaveBeenCalled()
})
