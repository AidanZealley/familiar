import { execFileSync } from 'node:child_process'
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
import {
  renderHiddenLauncher,
  renderLauncher,
  renderTask,
} from './windows-render.ts'
import { windowsService } from './windows.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const userId = 'S-1-5-21-1000'
let temporary: string
let running: boolean
let refused: boolean
let task: { node: string; args: string; enabled: boolean } | null
const launcher = () => resolve(temporary, 'data/service.cjs')
const shortcut = () => resolve(temporary, 'startup/Familiar.lnk')
const service = () =>
  windowsService({
    dataDir: resolve(temporary, 'data'),
    cliPath: resolve(temporary, 'app/familiar.js'),
    startupDir: resolve(temporary, 'startup'),
    userId,
  })
const script = (args: readonly string[] | undefined) =>
  Buffer.from(String(args?.at(-1)), 'base64').toString('utf16le')
const calls = () =>
  vi
    .mocked(execFileSync)
    .mock.calls.map(([command, args]) => [command, ...(args ?? [])].join(' '))
beforeEach(() => {
  temporary = mkdtempSync(resolve(tmpdir(), 'familiar-windows-'))
  running = false
  refused = false
  task = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(execFileSync)
    .mockReset()
    .mockImplementation((command, args) => {
      if (command === 'powershell.exe') {
        const source = script(args)
        if (source.includes('.GetTask(')) {
          return JSON.stringify(task) as never
        }
        if (source.includes('Get-CimInstance')) {
          return JSON.stringify(running ? [123] : []) as never
        }
        if (source.includes('CreateShortcut')) {
          if (source.includes('.Save()')) {
            writeFileSync(shortcut(), 'shortcut fixture')
            return '' as never
          }
          return JSON.stringify({
            node: process.execPath,
            args: `"${launcher()}"`,
          }) as never
        }
        if (source.includes('Start-Process')) {
          running = true
        }
        return '' as never
      }
      if (command === 'taskkill.exe') {
        running = false
      }
      if (command === 'schtasks.exe') {
        if (args?.[0] === '/Create') {
          if (refused) {
            throw Object.assign(new Error('access denied'), { status: 1 })
          }
          task = {
            node: process.execPath,
            args: `"${launcher()}"`,
            enabled: true,
          }
        }
        if (args?.includes('/DISABLE') && task) {
          task.enabled = false
        }
        if (args?.includes('/ENABLE') && task) {
          task.enabled = true
        }
        if (args?.[0] === '/Run') {
          running = true
        }
        if (args?.[0] === '/Delete') {
          task = null
        }
      }
      return '' as never
    })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(temporary, { recursive: true, force: true })
})

test('task XML runs as the owner at logon with restart limits and safe argument quoting', () => {
  const xml = renderTask(
    {
      dataDir: '/owner & data',
      cliPath: '/app/familiar.js',
      node: 'C:\\Program Files\\node.exe',
    },
    userId,
  )
  expect(xml).toContain('<LogonType>InteractiveToken</LogonType>')
  expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>')
  expect(xml).toContain(
    '<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count>',
  )
  expect(xml).toContain('owner &amp; data')
  expect(xml).toContain('&quot;')
  expect(xml).toContain('wscript.exe</Command>')
  expect(xml).toContain('service.vbs')
})

test('install registers once and repeat setup preserves a running instance', () => {
  const host = service()
  host.install()
  expect(host.isRunning()).toBe(true)
  vi.mocked(execFileSync).mockClear()
  host.install()
  expect(calls().some((call) => /\/Create|\/Run|taskkill/.test(call))).toBe(
    false,
  )
})

test('failed work disables restart, kills only the launcher tree and resumes the task', async () => {
  const host = service()
  host.install()
  await expect(
    host.withStopped(async () => {
      expect(running).toBe(false)
      expect(task?.enabled).toBe(false)
      throw new Error('cancelled')
    }),
  ).rejects.toThrow('cancelled')
  expect(running).toBe(true)
  expect(task?.enabled).toBe(true)
  expect(calls()).toContain('taskkill.exe /PID 123 /T /F')
})

test('refused registration uses a Startup shortcut with an explicit recovery limitation', () => {
  refused = true
  const host = service()
  host.install()
  expect(existsSync(shortcut())).toBe(true)
  expect(host.isRunning()).toBe(true)
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('automatic crash recovery is unavailable'),
  )
  host.uninstall()
  expect(existsSync(shortcut())).toBe(false)
  expect(existsSync(launcher())).toBe(false)
})

test('a task for another data directory cannot be replaced or deleted', () => {
  task = {
    node: process.execPath,
    args: '"C:\\other\\service.cjs"',
    enabled: true,
  }
  expect(() => service().install()).toThrow('different installation')
  expect(() => service().uninstall()).toThrow('different installation')
  expect(existsSync(launcher())).toBe(false)
  expect(calls().some((call) => /schtasks.exe|taskkill.exe/.test(call))).toBe(
    false,
  )
})

test('uninstall leaves the database and login behind', () => {
  const host = service()
  host.install()
  const database = resolve(temporary, 'data/familiar.sqlite')
  writeFileSync(database, 'conversation fixture')
  host.uninstall()
  expect(running).toBe(false)
  expect(task).toBeNull()
  expect(readFileSync(database, 'utf8')).toBe('conversation fixture')
})

test('the Windows launcher forwards logs and the daemon exit code', async () => {
  const native =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    )
  const dataDir = resolve(temporary, "Owner's files & data")
  mkdirSync(dataDir)
  const cliPath = resolve(temporary, 'fixture.cjs')
  writeFileSync(
    cliPath,
    'console.log(process.env.FAMILIAR_DATA_DIR); console.error(process.env.FAMILIAR_HOST); process.exitCode = 7;',
  )
  const file = resolve(dataDir, 'service.cjs')
  writeFileSync(file, renderLauncher({ dataDir, cliPath, workDir: temporary }))
  const hidden = resolve(dataDir, 'service.vbs')
  writeFileSync(
    hidden,
    '\ufeff' + renderHiddenLauncher({ dataDir, cliPath }),
    'utf16le',
  )
  const result = native.spawnSync(
    process.platform === 'win32' ? 'wscript.exe' : process.execPath,
    [process.platform === 'win32' ? hidden : file],
    {
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  expect(result.status).toBe(7)
  const log = readFileSync(resolve(dataDir, 'service.log'), 'utf8')
  expect(log).toContain(dataDir)
  expect(log).toContain('127.0.0.1')
})

test.skipIf(process.platform !== 'win32')(
  'native Windows parses service scripts and validates the task without registering it',
  async () => {
    const host = service()
    host.install()
    await host.withStopped(async () => {})
    host.logs()
    host.uninstall()
    refused = true
    host.install()
    const scripts = vi
      .mocked(execFileSync)
      .mock.calls.filter(([command]) => command === 'powershell.exe')
      .map(([, args]) => script(args))
    const native =
      await vi.importActual<typeof import('node:child_process')>(
        'node:child_process',
      )
    const source = `
$ErrorActionPreference = 'Stop';
$scripts = ${JSON.stringify(Buffer.from(JSON.stringify(scripts), 'utf8').toString('base64'))};
foreach ($source in ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($scripts)) | ConvertFrom-Json)) {
  $tokens = $null; $errors = $null;
  [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null;
  if ($errors.Count) { throw ($errors | Out-String) }
}
$xml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(renderTask({ dataDir: temporary, cliPath: resolve(temporary, 'app.js') }, userId), 'utf8').toString('base64')}'));
$xml = $xml.Replace('${userId}', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value);
$service = New-Object -ComObject Schedule.Service; $service.Connect();
$definition = $service.NewTask(0); $definition.XmlText = $xml;
`
    const file = resolve(temporary, 'validate.ps1')
    writeFileSync(file, '\ufeff' + source)
    native.execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        file,
      ],
      {
        stdio: 'pipe',
        timeout: 15000,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key.toLowerCase() !== 'psmodulepath',
          ),
        ),
      },
    )
  },
)
