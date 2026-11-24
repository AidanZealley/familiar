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
  node = process.execPath,
  path = process.env.PATH ?? '/usr/bin:/bin',
}: ServiceOptions) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(cliPath)}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${xml(dataDir)}</string>
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

/** A one-shot LaunchAgent running the CLI with `args`, for `runJob`. */
export function renderJob(
  {
    dataDir,
    cliPath,
    node = process.execPath,
    path = process.env.PATH ?? '/usr/bin:/bin',
  }: ServiceOptions,
  job: string,
  args: string[],
) {
  const program = [node, cliPath, ...args]
    .map((arg) => `<string>${xml(arg)}</string>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(job)}</string>
<key>ProgramArguments</key><array>${program}</array>
<key>WorkingDirectory</key><string>${xml(dataDir)}</string>
<key>EnvironmentVariables</key><dict>
${dataEntry(dataDir)}
<key>PATH</key><string>${xml(`${dirname(node)}:${path}`)}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
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
  const inspect = (job = target) => {
    try {
      return launchctl('print', job)
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
  const unload = (job: string) => {
    if (inspect(job) === undefined) {
      return
    }
    launchctl('bootout', job)
    // bootout returns while launchd is still removing the job. Starting
    // before it is gone would kickstart the dying job instead of loading it.
    const deadline = Date.now() + 10000
    while (inspect(job) !== undefined) {
      if (Date.now() > deadline) {
        throw new Error(`The LaunchAgent ${job} did not unload.`)
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
  const stop = () => unload(target)
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
    stop,
    start,
    restart,
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
    /**
     * Runs the CLI with `args` as the one-shot LaunchAgent
     * `com.familiar.daemon.<name>`, a job of its own, so stopping the
     * service doesn't stop it. Its plist lives in the data folder, so it
     * never runs at login. The last run's finished job is unloaded first.
     */
    runJob(name: string, args: string[]) {
      const job = `${label}.${name}`
      if (/^\s*pid = \d+/m.test(inspect(`${domain}/${job}`) ?? '')) {
        throw new Error(`The ${name} job is already running.`)
      }
      unload(`${domain}/${job}`)
      const plist = resolve(options.dataDir, `${name}-job.plist`)
      writeFileSync(plist, renderJob(options, job, args), { mode: 0o600 })
      launchctl('bootstrap', domain, plist)
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
