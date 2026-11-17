import { spawn } from 'node:child_process'
import { MAX_TEXT, shortenedNote } from './shorten.ts'

/**
 * Runs `command` with `/bin/sh` in `cwd`, stdout and stderr together. It
 * runs in its own process group, so stopping it (timeout or `signal`) also
 * stops whatever it started. Only the end of the output is kept as it runs,
 * so a command that prints without end can't use up memory.
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
    let total = 0
    const collect = (chunk: string) => {
      total += chunk.length
      output = (output + chunk).slice(-MAX_TEXT)
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
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', stop)
      resolve({
        code,
        output:
          total > MAX_TEXT ? `${shortenedNote(total)}\n${output}` : output,
        timedOut,
      })
    })
  })
}
