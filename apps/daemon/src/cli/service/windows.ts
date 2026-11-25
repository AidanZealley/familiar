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

/**
 * As `renderHiddenLauncher`, for any command, with `env` set for it first:
 * Task Scheduler runs with the user's own environment.
 */
function hiddenScript(command: string[], env: Record<string, string>) {
  const vb = (value: string) => `"${value.replaceAll('"', '""')}"`
  const line = command.map((part) => `"${part}"`).join(' ')
  const setEnv = Object.entries(env).map(
    ([key, value]) =>
      `shell.Environment("Process")(${vb(key)}) = ${vb(value)}\r\n`,
  )
  return Buffer.from(
    `\ufeffSet shell = CreateObject("WScript.Shell")\r\n${setEnv.join('')}WScript.Quit shell.Run(${vb(line)}, 0, True)\r\n`,
    'utf16le',
  )
}

/**
 * A task with no trigger, run on demand, for `runJob`: the CLI with `args`
 * as a process of its own, outside the service's tree, so stopping the
 * service doesn't stop it. One at a time.
 */
export function renderJobTask(
  { dataDir, node = process.execPath, cliPath }: ServiceOptions,
  userId: string,
  name: string,
  args: string[],
) {
  const script = resolve(dataDir, `${name}-job.vbs`)
  const launch = hiddenLaunch({ dataDir })
  return {
    script,
    content: hiddenScript([node, cliPath, ...args], {
      FAMILIAR_DATA_DIR: dataDir,
      PATH: `${win32.dirname(node)};${process.env.PATH ?? ''}`,
    }),
    xml: `<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Principals><Principal id="Owner"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings>
<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
<ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
</Settings>
<Actions Context="Owner"><Exec><Command>${xml(launch.command)}</Command><Arguments>${xml(`"${script}"`)}</Arguments><WorkingDirectory>${xml(dataDir)}</WorkingDirectory></Exec></Actions>
</Task>
`,
  }
}

/** A separate process gives Task Scheduler an exit code and a tree to stop. */
export function renderLauncher({
  dataDir,
  cliPath,
  node = process.execPath,
}: ServiceOptions) {
  return `const { openSync, writeSync } = require('node:fs');
const { spawn } = require('node:child_process');
process.env.FAMILIAR_DATA_DIR = ${JSON.stringify(dataDir)};
process.env.FAMILIAR_HOST = '127.0.0.1';
process.env.PATH = ${JSON.stringify(`${win32.dirname(node)};`)} + (process.env.PATH || '');
const log = openSync(${JSON.stringify(resolve(dataDir, 'service.log'))}, 'a', 0o600);
const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(cliPath)}, 'serve'], {
  cwd: ${JSON.stringify(dataDir)}, env: process.env, stdio: ['ignore', log, log], windowsHide: true,
});
child.on('error', (error) => { writeSync(log, String(error) + '\\n'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
`
}

export function renderTask({ dataDir }: ServiceOptions, userId: string) {
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
<Actions Context="Owner"><Exec><Command>${xml(launch.command)}</Command><Arguments>${xml(launch.args)}</Arguments><WorkingDirectory>${xml(dataDir)}</WorkingDirectory></Exec></Actions>
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
  // Match the quoted argument we emit, not a stale PID or another process
  // of the same program.
  const processIds = (program: string, argument: string): number[] =>
    JSON.parse(
      powershell(`
ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq ${quote(program)} -and $_.CommandLine -and $_.CommandLine.IndexOf(${quote(argument)}, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | Select-Object -ExpandProperty ProcessId)
`),
    )
  /** The daemon's launcher, as our task and shortcut start it. */
  const daemonIds = () => processIds(win32.basename(node), args)
  const isRunning = () => existsSync(launcher) && daemonIds().length > 0
  /** Starts `args` hidden, as a process outside the daemon's tree. */
  const launch = (args: string) =>
    powershell(
      `Start-Process -FilePath ${quote(hidden.command)} -ArgumentList ${quote(args)} -WorkingDirectory ${quote(options.dataDir)} -WindowStyle Hidden`,
    )
  const stop = () => {
    const { task } = registration()
    if (task?.enabled) {
      schtasks('/Change', '/TN', name, '/DISABLE')
    }
    for (const pid of daemonIds()) {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
  }
  const start = () => {
    const { task, link } = registration()
    if (link) {
      launch(hidden.args)
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
    /** Whether this data folder's service is registered, running or not. */
    isRegistered: () => {
      const { task, link } = registration()
      return Boolean(task ?? link)
    },
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
$link.WorkingDirectory = ${quote(options.dataDir)}; $link.WindowStyle = 7; $link.Save()
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
    /**
     * Runs the CLI with `args` as a job of its own, outside the daemon's
     * tree, so stopping the service doesn't stop it: as the on-demand task
     * `Familiar-<name>-<user>`, or, where task registration was refused and
     * the service starts from the Startup folder, launched as the service
     * is, refusing a second while one runs.
     */
    runJob(jobName: string, args: string[]) {
      const job = renderJobTask(options, userId, jobName, args)
      const { link } = registration()
      if (link) {
        const script = `"${job.script}"`
        if (processIds(win32.basename(hidden.command), script).length) {
          throw new Error(`The ${jobName} job is already running.`)
        }
        writeFileSync(job.script, job.content, { mode: 0o600 })
        launch(script)
        return
      }
      const file = resolve(options.dataDir, `${jobName}-job.xml`)
      writeFileSync(job.script, job.content, { mode: 0o600 })
      writeFileSync(file, job.xml, { mode: 0o600 })
      const task = `Familiar-${jobName}-${userId}`
      schtasks('/Create', '/TN', task, '/XML', file, '/F')
      schtasks('/Run', '/TN', task)
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
