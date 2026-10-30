import { dirname, resolve, win32 } from 'node:path'
import type { ServiceOptions } from './types.ts'
import { xml } from './xml.ts'

/** WScript has no console and waits so Task Scheduler retains crash recovery. */
export function renderHiddenLauncher({
  dataDir,
  node = process.execPath,
}: ServiceOptions) {
  const command = `"${node}" "${resolve(dataDir, 'service.cjs')}"`
  return `WScript.Quit CreateObject("WScript.Shell").Run("${command.replaceAll('"', '""')}", 0, True)\r\n`
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
  const launcher = resolve(dataDir, 'service.vbs')
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
<Actions Context="Owner"><Exec><Command>${xml(resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32/wscript.exe'))}</Command><Arguments>${xml(`"${launcher}"`)}</Arguments><WorkingDirectory>${xml(workDir)}</WorkingDirectory></Exec></Actions>
</Task>
`
}
