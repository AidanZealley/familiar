import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/**
 * Claim the data directory for this process. Pi Durable allows one process
 * per storage and has no cross-process locking, so a second daemon (say,
 * `pnpm dev` while the service runs) must stop before it opens anything.
 */
export function lockDataDir(path: string) {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const owner = Number(readFileSync(path, 'utf8'))
    if (isRunning(owner)) {
      console.error(
        `Familiar is already running (process ${owner}). Stop it first, e.g. systemctl --user stop familiar.`,
      )
      process.exit(1)
    }
    // Left behind by a process that crashed.
    writeFileSync(path, String(process.pid), { mode: 0o600 })
  }
  process.on('exit', () => rmSync(path, { force: true }))
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
