import { execFileSync } from 'node:child_process'
import { afterEach, expect, test, vi } from 'vitest'
import { powershell, powershellString } from './windows-powershell.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

test('Windows commands use encoded Unicode scripts with literal paths and no profiles', () => {
  powershell(
    `Get-Item -LiteralPath ${powershellString("C:\\Users\\Owner's files & 家")}`,
  )
  const [command, args] = vi.mocked(execFileSync).mock.calls[0]
  expect(command).toBe('powershell.exe')
  expect(args).toContain('-NoProfile')
  const source = Buffer.from(String(args?.at(-1)), 'base64').toString('utf16le')
  expect(source).toContain("Owner''s files & 家")
})

test('log following inherits terminal output without a command timeout', () => {
  powershell('Get-Content service.log -Wait', true)
  expect(vi.mocked(execFileSync).mock.calls[0][2]).toMatchObject({
    stdio: 'inherit',
    timeout: undefined,
  })
})

test('Windows PowerShell does not inherit incompatible PowerShell 7 module paths', () => {
  vi.stubEnv('PSModulePath', 'C:\\Program Files\\PowerShell\\7\\Modules')
  vi.stubEnv('FAMILIAR_TEST_ENV', 'preserved')
  powershell('Get-Acl .')
  const options = vi.mocked(execFileSync).mock.calls[0][2]
  expect(options?.env).not.toHaveProperty('PSModulePath')
  expect(options?.env).toHaveProperty('FAMILIAR_TEST_ENV', 'preserved')
})
