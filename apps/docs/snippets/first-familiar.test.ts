import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

// The first guide tells readers to run this file as it is.
test('the first Familiar example runs and prints its conversation', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL('first-familiar.ts', import.meta.url).pathname,
  ])
  expect(stdout).toBe('Sam: Hello\nFamiliar: Hello, Sam.\n')
}, 30_000)
