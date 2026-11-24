import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { ensureDataDir } from '../../paths.ts'
import type { ServiceOptions } from './types.ts'

type LinuxOptions = ServiceOptions & { unitDir?: string }

// systemd expands percent specifiers in all fields. The ':' command prefix
// disables environment expansion in ExecStart, preserving literal dollar signs.
const quote = (value: string) => JSON.stringify(value.replaceAll('%', '%%'))

export function renderUnit({
  dataDir,
  cliPath,
  node = process.execPath,
  path = process.env.PATH ?? '/usr/bin:/bin',
}: ServiceOptions) {
  if (/[\r\n]/.test(dataDir)) {
    throw new Error('The data directory cannot contain a newline.')
  }
  // Tools that write to their working directory, such as a browser MCP's
  // output, write into the data folder, never into the package an update
  // replaces.
  return `[Unit]
Description=Familiar, a personal assistant
After=network-online.target

[Service]
Type=exec
WorkingDirectory=${dataDir.replaceAll('%', '%%')}
ExecStart=:${quote(node)} ${quote(cliPath)} serve
Environment=${quote(`FAMILIAR_DATA_DIR=${dataDir}`)}
Environment=FAMILIAR_HOST=127.0.0.1
Environment=${quote(`PATH=${dirname(node)}:${path}`)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

/** `systemd-run`'s arguments for `runJob`, with the service's environment. */
export function jobCommand(
  {
    dataDir,
    cliPath,
    node = process.execPath,
    path = process.env.PATH ?? '/usr/bin:/bin',
  }: ServiceOptions,
  name: string,
  args: string[],
) {
  return [
    '--user',
    `--unit=familiar-${name}`,
    // Forget it once it ends, failed or not, so the name is free again.
    '--collect',
    '--quiet',
    `--working-directory=${dataDir}`,
    `--setenv=FAMILIAR_DATA_DIR=${dataDir}`,
    `--setenv=PATH=${dirname(node)}:${path}`,
    '--',
    node,
    cliPath,
    ...args,
  ]
}

export function linuxService(options: LinuxOptions) {
  const unit = resolve(
    options.unitDir ??
      resolve(
        process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config'),
        'systemd/user',
      ),
    'familiar.service',
  )
  const dataEnvironment = `Environment=${quote(`FAMILIAR_DATA_DIR=${options.dataDir}`)}`
  const installedUnit = () =>
    existsSync(unit) ? readFileSync(unit, 'utf8') : ''
  const ownsData = () => installedUnit().split('\n').includes(dataEnvironment)
  const checkOwnership = () => {
    if (installedUnit() && !ownsData()) {
      throw new Error(
        'The Familiar service belongs to a different data directory. Keep that installation or uninstall its service first.',
      )
    }
  }
  const systemctl = (...args: string[]) =>
    execFileSync('systemctl', ['--user', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const isRunning = () => {
    try {
      systemctl('is-active', '--quiet', 'familiar')
      return true
    } catch (error) {
      if ([3, 4].includes((error as { status: number }).status)) {
        return false
      }
      throw error
    }
  }
  const restart = () => {
    systemctl('restart', 'familiar')
  }
  return {
    isRunning: () => ownsData() && isRunning(),
    stop: () => {
      systemctl('stop', 'familiar')
    },
    start: () => {
      systemctl('start', 'familiar')
    },
    restart,
    install(forceRestart = false) {
      checkOwnership()
      const content = renderUnit(options)
      const changed =
        !existsSync(unit) || readFileSync(unit, 'utf8') !== content
      if (changed) {
        ensureDataDir(options.dataDir)
        mkdirSync(dirname(unit), { recursive: true })
        writeFileSync(unit, content)
        systemctl('daemon-reload')
      }
      systemctl('enable', 'familiar')
      if (changed || forceRestart) {
        restart()
      } else if (!isRunning()) {
        systemctl('start', 'familiar')
      }
      const username = userInfo().username
      try {
        if (
          execFileSync(
            'loginctl',
            ['show-user', username, '--property=Linger', '--value'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim() !== 'yes'
        ) {
          execFileSync('loginctl', ['enable-linger', username], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        }
      } catch {
        console.log(
          `To run Familiar when you are logged out, run: sudo loginctl enable-linger ${username}`,
        )
      }
      console.log(
        changed
          ? 'Installed and started the Familiar service.'
          : 'Familiar service is installed and running.',
      )
    },
    uninstall() {
      checkOwnership()
      if (!existsSync(unit)) {
        return
      }
      systemctl('disable', '--now', 'familiar')
      rmSync(unit)
      systemctl('daemon-reload')
    },
    /**
     * Runs the CLI with `args` as the transient unit `familiar-<name>`, in
     * its own cgroup, so stopping the service doesn't stop it. systemd
     * refuses a second while one runs.
     */
    runJob(name: string, args: string[]) {
      execFileSync('systemd-run', jobCommand(options, name, args), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    },
    logs() {
      execFileSync('journalctl', ['--user', '-u', 'familiar', '-f'], {
        stdio: 'inherit',
      })
    },
  }
}
