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
import { resolvePaths } from '../paths.ts'

type ServiceOptions = {
  dataDir: string
  cliPath: string
  workDir?: string
  node?: string
  unitDir?: string
}

// systemd expands percent specifiers in all fields. The ':' command prefix
// disables environment expansion in ExecStart, preserving literal dollar signs.
const quote = (value: string) => JSON.stringify(value.replaceAll('%', '%%'))

export function renderUnit({
  dataDir,
  cliPath,
  workDir = dirname(cliPath),
  node = process.execPath,
}: ServiceOptions) {
  if (/[\r\n]/.test(workDir)) {
    throw new Error('The service working directory cannot contain a newline.')
  }
  return `[Unit]
Description=Familiar, a personal assistant
After=network-online.target

[Service]
Type=exec
WorkingDirectory=${workDir.replaceAll('%', '%%')}
ExecStart=:${quote(node)} ${quote(cliPath)} serve
Environment=${quote(`FAMILIAR_DATA_DIR=${dataDir}`)}
Environment=FAMILIAR_HOST=127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

export function linuxService(options: ServiceOptions) {
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
  const ownsData = () => {
    const current = installedUnit()
    if (!current) {
      return false
    }
    return current.includes('FAMILIAR_DATA_DIR=')
      ? current.split('\n').includes(dataEnvironment)
      : options.dataDir ===
          resolvePaths({
            env: { ...process.env, FAMILIAR_DATA_DIR: undefined },
          }).dataDir
  }
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
  const stop = () => {
    systemctl('stop', 'familiar')
  }
  const restart = () => {
    systemctl('restart', 'familiar')
  }
  return {
    isRunning,
    restart,
    async withStopped<T>(run: () => Promise<T>) {
      const running = ownsData() && isRunning()
      if (running) {
        stop()
      }
      try {
        return await run()
      } finally {
        if (running) {
          restart()
        }
      }
    },
    install(forceRestart = false) {
      checkOwnership()
      const content = renderUnit(options)
      const changed =
        !existsSync(unit) || readFileSync(unit, 'utf8') !== content
      if (changed) {
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
    logs() {
      execFileSync('journalctl', ['--user', '-u', 'familiar', '-f'], {
        stdio: 'inherit',
      })
    },
  }
}
