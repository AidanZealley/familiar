import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * Claim a data directory for this process, through a lock at `path`.
 * Pi Durable allows one process per storage and has no cross-process
 * locking, so a second process must stop before it opens anything. Throws
 * while another process holds it.
 */
export function lockDataDir(path: string) {
  const lock = takeLock(path)
  if (!lock.taken) {
    throw new Error(
      `Familiar is already running${byProcess(lock.holder)}. Stop it first.`,
    )
  }
}

/** " (process 123)", or nothing when the holder didn't say. */
const byProcess = (holder: number | undefined) =>
  holder ? ` (process ${holder})` : ''

/**
 * Locks held by this process, kept referenced: closing one, as collecting
 * it would, lets the lock go.
 */
const held = new Set<DatabaseSync>()

/**
 * Take the lock at `path` for this process, until it's released or the
 * process exits, or say which process holds it, if it said.
 *
 * The lock is the operating system's, taken through SQLite on
 * `<path>.db`: the kernel lets it go when its holder exits, crashed or
 * not, so there's no stale lock to judge or take over, and two processes
 * can never both hold it. `path` holds the holder's process ID for
 * messages and for versions before `<path>.db`, which lock by it alone,
 * written whole once it holds the lock. So either version refuses while
 * the other runs, across an update or a rollback. `<path>.db` is never
 * removed, as a second file would be a second lock.
 */
export function takeLock(
  path: string,
): { taken: true; release(): void } | { taken: false; holder?: number } {
  const db = new DatabaseSync(`${path}.db`)
  try {
    // Waits out another process's brief look in `lockHeld`.
    db.exec('PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE')
  } catch (error) {
    db.close()
    if (!isBusy(error)) {
      throw error
    }
    return { taken: false, holder: recordedHolder(path) }
  }
  // An older version, holding it by process ID alone.
  const legacy = legacyHolder(path)
  if (legacy !== undefined) {
    db.close()
    return { taken: false, holder: legacy }
  }
  try {
    // Older versions read it to stay out, so without it nothing is held.
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, String(process.pid), { mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    db.close()
    throw error
  }
  held.add(db)
  const release = () => {
    process.off('exit', release)
    if (!held.delete(db)) {
      return
    }
    try {
      // Before letting go, so it never names the next holder.
      rmSync(path, { force: true })
    } finally {
      db.close()
    }
  }
  process.on('exit', release)
  return { taken: true, release }
}

/** Whether a process holds the lock at `path`. */
export function lockHeld(path: string): boolean {
  if (legacyHolder(path) !== undefined) {
    return true
  }
  if (!existsSync(`${path}.db`)) {
    return false
  }
  const db = new DatabaseSync(`${path}.db`)
  try {
    // A shared lock, refused while another holds it exclusively.
    db.exec(
      'PRAGMA busy_timeout = 0; BEGIN; SELECT count(*) FROM sqlite_master; COMMIT',
    )
    return false
  } catch (error) {
    if (!isBusy(error)) {
      throw error
    }
    return true
  } finally {
    db.close()
  }
}

const isBusy = (error: unknown) =>
  (error as { errcode?: number }).errcode === SQLITE_BUSY

const SQLITE_BUSY = 5

/** The process ID the holder recorded at `path`, if it has yet. */
function recordedHolder(path: string) {
  try {
    const pid = Number(readFileSync(path, 'utf8'))
    return pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

/**
 * The live process, other than this one, that `path` names: how a version
 * before `<path>.db` holds it, and leaves it on a crash. This version
 * writes it too, so it also names this version's holder.
 */
function legacyHolder(path: string) {
  const pid = recordedHolder(path)
  return pid && pid !== process.pid && isRunning(pid) ? pid : undefined
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
