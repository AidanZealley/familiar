import { spawn } from 'node:child_process'
import { KEEP_TEXT } from '../shorten.ts'

/**
 * Runs `command` with `/bin/sh` in `cwd`, stdout and stderr together. It
 * runs in its own process group, so stopping it (timeout or `signal`) also
 * stops whatever it started. It ends when the shell does: a program it left
 * running in the background, such as an app with a window, keeps running,
 * but what it prints after isn't collected. Only the output's last
 * `KEEP_TEXT` characters are kept as it runs, so a command that prints
 * without end can't use up memory.
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
    const collect = (chunk: string) => {
      output = (output + chunk).slice(-KEEP_TEXT)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
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
    // A background program holds the output open; the command is done once
    // the shell is, after a moment for the output already sent to arrive.
    child.on('exit', () =>
      setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
      }, 100),
    )
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', stop)
      resolve({ code, output, timedOut })
    })
  })
}
