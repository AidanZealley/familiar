import { execFileSync } from 'node:child_process'
import { afterEach, expect, test, vi } from 'vitest'
import { powershell, protectWindowsDirectory } from './windows-powershell.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }))
afterEach(() => {
  vi.clearAllMocks()
})

test('Windows commands use encoded Unicode scripts with literal paths and no profiles', () => {
  protectWindowsDirectory("C:\\Users\\Owner's files & 家\\Familiar")
  const [command, args] = vi.mocked(execFileSync).mock.calls[0]
  expect(command).toBe('powershell.exe')
  expect(args).toContain('-NoProfile')
  const source = Buffer.from(String(args?.at(-1)), 'base64').toString('utf16le')
  expect(source).toContain("Owner''s files & 家")
  expect(source).toContain('SetAccessRuleProtection($true, $false)')
  expect(source).toContain('Set-Acl -LiteralPath $directory')
})

test('log following inherits terminal output without a command timeout', () => {
  powershell('Get-Content service.log -Wait', true)
  expect(vi.mocked(execFileSync).mock.calls[0][2]).toMatchObject({
    stdio: 'inherit',
    timeout: undefined,
  })
})
