import { spawn } from 'node:child_process'

/**
 * Runs `command` with `/bin/sh` in `cwd`, stdout and stderr together. It
 * runs in its own process group, so stopping it (timeout or `signal`) also
 * stops whatever it started.
 */
export function runCommand(
  command: string,
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
) {
  return new Promise<{
    code: number | null
    output: string
    timedOut: boolean
  }>((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    let timedOut = false
    const stop = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, options.timeoutMs)
    options.signal.addEventListener('abort', stop, { once: true })

    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', stop)
      resolve({ code, output, timedOut })
    })
  })
}
