import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { expect, onTestFinished, test } from 'vitest'
import { lockHeld, takeLock } from './lock.ts'

const lockFile = () => join(mkdtempSync(join(tmpdir(), 'lock-')), 'test.lock')

/**
 * A process that tries to take the lock at `path`, says whether it did,
 * and holds it until it's told to exit or killed.
 */
async function contender(path: string) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { takeLock } from ${JSON.stringify(new URL('./lock.ts', import.meta.url).href)}
       console.log(takeLock(${JSON.stringify(path)}).taken)
       process.stdin.resume()
       process.stdin.on('end', () => process.exit())`,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  onTestFinished(() => {
    child.kill('SIGKILL')
  })
  const [line] = (await once(child.stdout, 'data')) as [Buffer]
  return { child, taken: line.toString().trim() === 'true' }
}

test('processes racing for a lock never both hold it', async () => {
  const path = lockFile()
  // A file left empty, as by a crash mid-write, decides nothing.
  writeFileSync(path, '')
  const results = await Promise.all(
    Array.from({ length: 6 }, () => contender(path)),
  )
  expect(results.filter((result) => result.taken)).toHaveLength(1)
  expect(lockHeld(path)).toBe(true)
  expect(takeLock(path)).toMatchObject({ taken: false })
})

test('a lock is free once its holder exits, even by crashing', async () => {
  const path = lockFile()
  const { child, taken } = await contender(path)
  expect(taken).toBe(true)
  const holder = takeLock(path)
  expect(holder).toEqual({ taken: false, holder: child.pid })

  child.kill('SIGKILL')
  await once(child, 'exit')
  expect(lockHeld(path)).toBe(false)
  const lock = takeLock(path)
  expect(lock.taken).toBe(true)
  // Within one process too, a lock is held once.
  expect(takeLock(path).taken).toBe(false)
  if (lock.taken) {
    lock.release()
  }
  expect(lockHeld(path)).toBe(false)
})
