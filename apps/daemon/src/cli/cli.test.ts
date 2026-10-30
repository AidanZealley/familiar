import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const cli = join(import.meta.dirname, '../cli.ts')

test('help and invalid commands do not create private storage', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'familiar-cli-'))
  const data = join(temporary, 'private')
  const env: NodeJS.ProcessEnv = { ...process.env, FAMILIAR_DATA_DIR: data }
  try {
    expect(
      execFileSync(process.execPath, [cli, '--help'], {
        env,
        encoding: 'utf8',
      }),
    ).toContain('Usage: familiar')
    expect(() =>
      execFileSync(process.execPath, [cli, 'unknown'], { env, stdio: 'pipe' }),
    ).toThrow()
    expect(() =>
      execFileSync(process.execPath, [cli, 'status', 'extra'], {
        env,
        stdio: 'pipe',
      }),
    ).toThrow()
    expect(() =>
      execFileSync(process.execPath, [cli, 'rename', 'one', 'two'], {
        env,
        stdio: 'pipe',
      }),
    ).toThrow()
    expect(existsSync(data)).toBe(false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('serve starts with saved settings and isolated SQLite storage', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'familiar-cli-'))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string') {
    throw new Error('No test port')
  }
  const port = address.port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  writeFileSync(
    join(temporary, 'settings.json'),
    JSON.stringify({ name: 'CLI test', port }),
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAMILIAR_DATA_DIR: temporary,
    FAMILIAR_HOST: '127.0.0.1',
    FAMILIAR_PLUGINS: '',
  }
  delete env.FAMILIAR_PORT
  delete env.FAMILIAR_NAME
  const child = spawn(process.execPath, [cli, 'serve'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  let output = ''
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CLI did not start: ${output}`)),
        15000,
      )
      child.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes(`CLI test on http://127.0.0.1:${port}`)) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error(`CLI exited before startup: ${output}`))
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    expect(existsSync(join(temporary, 'familiar.sqlite'))).toBe(true)
    // A read-only request checks that the HTTP listener belongs to this daemon.
    const response = await fetch(`http://127.0.0.1:${port}/api/connections`)
    expect(response.ok).toBe(true)
  } finally {
    child.kill('SIGTERM')
    await exited
    rmSync(temporary, { recursive: true, force: true })
  }
}, 20000)
