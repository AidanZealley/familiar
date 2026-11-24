import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/**
 * Claim a data directory for this process, through a lock file at `path`.
 * Pi Durable allows one process per storage and has no cross-process
 * locking, so a second process must stop before it opens anything. Throws
 * while another live process holds it; a crashed one's lock is taken over.
 */
export function lockDataDir(path: string) {
  const lock = takeLock(path)
  if (!lock.taken) {
    throw new Error(
      `Familiar is already running (process ${lock.holder}). Stop it first.`,
    )
  }
}

/**
 * Take the lock file at `path` for this process, until it's released or
 * the process exits, or say which live process holds it. A crashed
 * holder's lock is taken over.
 */
export function takeLock(
  path: string,
): { taken: true; release(): void } | { taken: false; holder: number } {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
    const holder = lockHolder(path)
    if (holder !== undefined) {
      return { taken: false, holder }
    }
    // Left behind by a process that crashed.
    writeFileSync(path, String(process.pid), { mode: 0o600 })
  }
  const release = () => {
    rmSync(path, { force: true })
    process.off('exit', release)
  }
  process.on('exit', release)
  return { taken: true, release }
}

/** The live process holding the lock file at `path`, if any. */
export function lockHolder(path: string): number | undefined {
  let owner: number
  try {
    owner = Number(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  // An empty or torn file names no process; 0 would mean our own group.
  return owner > 0 && isRunning(owner) ? owner : undefined
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
