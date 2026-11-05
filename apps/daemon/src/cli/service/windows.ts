import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve, win32 } from 'node:path'
import { ensureDataDir } from '../../paths.ts'
import { powershell, powershellString as quote } from './powershell.ts'
import type { ServiceOptions } from './types.ts'
import { xml } from './xml.ts'

/**
 * The task and the Startup shortcut both start Familiar through this console-free command.
 * Microsoft is retiring VBScript. To replace the wrapper, change this and
 * renderHiddenLauncher.
 */
export function hiddenLaunch({ dataDir }: Pick<ServiceOptions, 'dataDir'>) {
  const path = resolve(dataDir, 'service.vbs')
  return {
    path,
    command: resolve(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32/wscript.exe',
    ),
    args: `"${path}"`,
  }
}

/**
 * WScript has no console and waits so Task Scheduler retains crash recovery.
 * UTF-16 with a byte order mark is the one script encoding it reads on every locale.
 */
export function renderHiddenLauncher({
  dataDir,
  node = process.execPath,
}: ServiceOptions) {
  const command = `"${node}" "${resolve(dataDir, 'service.cjs')}"`
  return Buffer.from(
    `\ufeffWScript.Quit CreateObject("WScript.Shell").Run("${command.replaceAll('"', '""')}", 0, True)\r\n`,
    'utf16le',
  )
}

/** A separate process gives Task Scheduler an exit code and a tree to stop. */
export function renderLauncher({
  dataDir,
  cliPath,
  workDir = dirname(cliPath),
  node = process.execPath,
}: ServiceOptions) {
  return `const { openSync, writeSync } = require('node:fs');
const { spawn } = require('node:child_process');
process.env.FAMILIAR_DATA_DIR = ${JSON.stringify(dataDir)};
process.env.FAMILIAR_HOST = '127.0.0.1';
process.env.PATH = ${JSON.stringify(`${win32.dirname(node)};`)} + (process.env.PATH || '');
const log = openSync(${JSON.stringify(resolve(dataDir, 'service.log'))}, 'a', 0o600);
const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(cliPath)}, 'serve'], {
  cwd: ${JSON.stringify(workDir)}, env: process.env, stdio: ['ignore', log, log], windowsHide: true,
});
child.on('error', (error) => { writeSync(log, String(error) + '\\n'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
`
}

export function renderTask(
  { dataDir, cliPath, workDir = dirname(cliPath) }: ServiceOptions,
  userId: string,
) {
  const launch = hiddenLaunch({ dataDir })
  // Omit a byte encoding so the XML also works as a Unicode COM string.
  return `<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Owner"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings>
<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
<StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
</Settings>
<Actions Context="Owner"><Exec><Command>${xml(launch.command)}</Command><Arguments>${xml(launch.args)}</Arguments><WorkingDirectory>${xml(workDir)}</WorkingDirectory></Exec></Actions>
</Task>
`
}

type WindowsOptions = ServiceOptions & { startupDir?: string; userId?: string }
type Action = { node: string; args: string }
type Task = Action & { enabled: boolean }
export function windowsService(options: WindowsOptions) {
  const node = options.node ?? process.execPath
  const userId =
    options.userId ??
    powershell(
      '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ).trim()
  if (!/^S-\d+(?:-\d+)+$/.test(userId)) {
    throw new Error(
      'Cannot identify the Windows user for Familiar service setup.',
    )
  }
  const name = `Familiar-${userId}`
  const launcher = resolve(options.dataDir, 'service.cjs')
  const hidden = hiddenLaunch(options)
  const taskFile = resolve(options.dataDir, 'service-task.xml')
  const shortcut = resolve(
    options.startupDir ??
      resolve(
        process.env.APPDATA ?? resolve(homedir(), 'AppData/Roaming'),
        'Microsoft/Windows/Start Menu/Programs/Startup',
      ),
    'Familiar.lnk',
  )
  // How the running daemon's node process names its launcher.
  const args = `"${launcher}"`
  const matches = (action: Action) =>
    action.args.toLowerCase() === hidden.args.toLowerCase()
  const schtasks = (...command: string[]) =>
    execFileSync('schtasks.exe', command, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  const readTask = (): Task | null =>
    JSON.parse(
      powershell(`
$service = New-Object -ComObject Schedule.Service; $service.Connect();
try {
  $task = $service.GetFolder('\\').GetTask(${quote(name)});
  $xml = [xml]$task.Xml;
  @{node = [string]$xml.Task.Actions.Exec.Command; args = [string]$xml.Task.Actions.Exec.Arguments; enabled = [bool]$task.Enabled} | ConvertTo-Json -Compress
} catch {
  $cause = $_.Exception; while ($cause.InnerException) { $cause = $cause.InnerException }
  if ($cause.HResult -eq -2147024894) { 'null' } else { throw }
}`),
    )
  const readShortcut = (): Action | null =>
    !existsSync(shortcut)
      ? null
      : JSON.parse(
          powershell(`
$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)});
@{node = $link.TargetPath; args = $link.Arguments} | ConvertTo-Json -Compress
`),
        )
  const registration = () => {
    const task = readTask()
    const link = readShortcut()
    if ((task && !matches(task)) || (link && !matches(link))) {
      throw new Error(
        'The Familiar Windows startup entry belongs to a different installation or data directory.',
      )
    }
    return { task, link }
  }
  // Match the quoted launcher argument our task and shortcut emit, not a stale PID or another node.exe process.
  const processIds = (): number[] =>
    JSON.parse(
      powershell(`
ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq ${quote(win32.basename(node))} -and $_.CommandLine -and $_.CommandLine.IndexOf(${quote(args)}, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | Select-Object -ExpandProperty ProcessId)
`),
    )
  const isRunning = () => existsSync(launcher) && processIds().length > 0
  const stop = () => {
    const { task } = registration()
    if (task?.enabled) {
      schtasks('/Change', '/TN', name, '/DISABLE')
    }
    for (const pid of processIds()) {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
  }
  const start = () => {
    const { task, link } = registration()
    if (link) {
      powershell(
        `Start-Process -FilePath ${quote(hidden.command)} -ArgumentList ${quote(hidden.args)} -WorkingDirectory ${quote(options.workDir ?? dirname(options.cliPath))} -WindowStyle Hidden`,
      )
    } else if (task) {
      if (!task.enabled) {
        schtasks('/Change', '/TN', name, '/ENABLE')
      }
      schtasks('/Run', '/TN', name)
    } else {
      throw new Error(
        'Familiar has no Windows startup entry. Run familiar to install it.',
      )
    }
  }
  const restart = () => {
    stop()
    start()
  }
  return {
    isRunning,
    stop,
    start,
    restart,
    install(forceRestart = false) {
      const current = registration()
      const source = renderLauncher(options)
      const hiddenSource = renderHiddenLauncher(options)
      const taskXml = renderTask(options, userId)
      const changed =
        !existsSync(launcher) ||
        readFileSync(launcher, 'utf8') !== source ||
        !existsSync(hidden.path) ||
        !readFileSync(hidden.path).equals(hiddenSource) ||
        !existsSync(taskFile) ||
        readFileSync(taskFile, 'utf8') !== taskXml
      const running = isRunning()
      if (changed || forceRestart || (!current.task && !current.link)) {
        if (running) {
          stop()
        }
        ensureDataDir(options.dataDir)
        writeFileSync(launcher, source, { mode: 0o600 })
        writeFileSync(hidden.path, hiddenSource, { mode: 0o600 })
        writeFileSync(taskFile, taskXml, { mode: 0o600 })
        try {
          schtasks('/Create', '/TN', name, '/XML', taskFile, '/F')
          if (current.link) {
            rmSync(shortcut)
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw error
          }
          mkdirSync(dirname(shortcut), { recursive: true })
          powershell(`
$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)});
$link.TargetPath = ${quote(hidden.command)}; $link.Arguments = ${quote(hidden.args)};
$link.WorkingDirectory = ${quote(options.workDir ?? dirname(options.cliPath))}; $link.WindowStyle = 7; $link.Save()
`)
          console.log(
            'Task registration was refused. Using the Startup folder; automatic crash recovery is unavailable in this mode.',
          )
        }
        start()
      } else if (!running) {
        start()
      }
      console.log(
        'Familiar Windows startup is installed and running. It starts when you log in.',
      )
    },
    uninstall() {
      const current = registration()
      if (isRunning()) {
        stop()
      }
      if (current.task) {
        schtasks('/Delete', '/TN', name, '/F')
      }
      if (current.link) {
        rmSync(shortcut)
      }
      rmSync(launcher, { force: true })
      rmSync(hidden.path, { force: true })
      rmSync(taskFile, { force: true })
    },
    logs() {
      powershell(
        `Get-Content -LiteralPath ${quote(resolve(options.dataDir, 'service.log'))} -Tail 100 -Wait`,
        true,
      )
    },
  }
}
