import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { ensureDataDir } from '../../paths.ts'
import type { ServiceOptions } from './types.ts'
import { xml } from './xml.ts'

const label = 'com.familiar.daemon'
const dataEntry = (dataDir: string) =>
  `<key>FAMILIAR_DATA_DIR</key><string>${xml(dataDir)}</string>`
type MacOptions = ServiceOptions & { agentDir?: string; uid?: number }

export function renderAgent({
  dataDir,
  cliPath,
  workDir = dirname(cliPath),
  node = process.execPath,
  path = process.env.PATH ?? '/usr/bin:/bin',
}: ServiceOptions) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(cliPath)}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${xml(workDir)}</string>
<key>EnvironmentVariables</key><dict>
${dataEntry(dataDir)}
<key>FAMILIAR_HOST</key><string>127.0.0.1</string>
<key>PATH</key><string>${xml(`${dirname(node)}:${path}`)}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(resolve(dataDir, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(dataDir, 'service.log'))}</string>
</dict></plist>
`
}

export function macosService(options: MacOptions) {
  const file = resolve(
    options.agentDir ?? resolve(homedir(), 'Library/LaunchAgents'),
    `${label}.plist`,
  )
  const uid = options.uid ?? process.getuid?.()
  if (uid === undefined) {
    throw new Error('A macOS user ID is required for LaunchAgent setup.')
  }
  const domain = `gui/${uid}`
  const target = `${domain}/${label}`
  const launchctl = (...args: string[]) =>
    execFileSync('launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const ownsData = () =>
    existsSync(file) &&
    readFileSync(file, 'utf8').includes(dataEntry(options.dataDir))
  const checkOwnership = () => {
    if (existsSync(file) && !ownsData()) {
      throw new Error(
        'The Familiar LaunchAgent belongs to a different data directory.',
      )
    }
  }
  const inspect = () => {
    try {
      return launchctl('print', target)
    } catch (error) {
      const failure = error as { stderr?: string; status?: number }
      if (
        [3, 113].includes(failure.status ?? 0) ||
        /could not find service|could not find domain/i.test(
          failure.stderr ?? '',
        )
      ) {
        return undefined
      }
      throw error
    }
  }
  const isRunning = () => ownsData() && /^\s*pid = \d+/m.test(inspect() ?? '')
  const stop = () => {
    if (inspect() !== undefined) {
      launchctl('bootout', target)
    }
  }
  const start = () => {
    launchctl('enable', target)
    if (inspect() === undefined) {
      launchctl('bootstrap', domain, file)
    } else {
      launchctl('kickstart', target)
    }
  }
  const restart = () => {
    checkOwnership()
    stop()
    start()
  }
  return {
    isRunning,
    restart,
    async withStopped<T>(run: () => Promise<T>) {
      const running = isRunning()
      if (running) {
        stop()
      }
      try {
        return await run()
      } finally {
        if (running) {
          start()
        }
      }
    },
    install(forceRestart = false) {
      checkOwnership()
      const content = renderAgent(options)
      const changed =
        !existsSync(file) || readFileSync(file, 'utf8') !== content
      ensureDataDir(options.dataDir)
      if (changed) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content, { mode: 0o600 })
      }
      if (changed || forceRestart) {
        restart()
      } else if (!isRunning()) {
        start()
      }
      console.log(
        'Familiar LaunchAgent is installed and running. It starts when you log in; a headless Mac needs a logged-in user session.',
      )
    },
    uninstall() {
      checkOwnership()
      if (!existsSync(file)) {
        return
      }
      stop()
      rmSync(file)
    },
    logs() {
      execFileSync(
        'tail',
        ['-n', '100', '-F', resolve(options.dataDir, 'service.log')],
        { stdio: 'inherit' },
      )
    },
  }
}
