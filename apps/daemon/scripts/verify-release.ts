import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OAuthAuth } from '@earendil-works/pi-ai'
import { runNpm } from '../src/cli/npm.ts'

// Install outside the workspace so missing dependencies and assets cannot
// accidentally resolve from the developer's checkout.
const temporary = await mkdtemp(resolve(tmpdir(), 'familiar-release-'))
const prefix = resolve(temporary, 'install with spaces & symbols')
const bin = resolve(temporary, 'bin')
await mkdir(bin)
if (process.platform === 'linux') {
  await writeFile(
    resolve(bin, 'systemctl'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAMILIAR_RELEASE_TEST_DIR/service-calls"
case "$2" in
  is-active) test -f "$FAMILIAR_RELEASE_TEST_DIR/running" || exit 3 ;;
  start|restart) touch "$FAMILIAR_RELEASE_TEST_DIR/running" ;;
  stop|disable) rm -f "$FAMILIAR_RELEASE_TEST_DIR/running" ;;
  enable|daemon-reload) exit 0 ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  )
  await writeFile(resolve(bin, 'loginctl'), '#!/bin/sh\necho yes\n', {
    mode: 0o755,
  })
  await writeFile(
    resolve(bin, 'tailscale'),
    `#!/bin/sh
echo '{"BackendState":"NeedsLogin"}'
`,
    { mode: 0o755 },
  )
}
const env: NodeJS.ProcessEnv = {
  ...process.env,
  FAMILIAR_DATA_DIR: resolve(temporary, 'data'),
  FAMILIAR_HOST: '127.0.0.1',
  FAMILIAR_NAME: 'Release test',
  FAMILIAR_PLUGINS: '',
  NODE_PATH: '',
  FAMILIAR_RELEASE_TEST_DIR: temporary,
  PATH: `${bin}${delimiter}${process.env.PATH}`,
  XDG_CONFIG_HOME: resolve(temporary, 'config'),
}

try {
  runNpm(
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--omit=optional',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      resolve(import.meta.dirname, '../dist/familiar.tgz'),
    ],
    { cwd: temporary, env, stdio: 'inherit' },
  )
  const installed = resolve(
    prefix,
    process.platform === 'win32'
      ? 'node_modules/familiar'
      : 'lib/node_modules/familiar',
  )
  const executable =
    process.platform === 'win32'
      ? process.execPath
      : resolve(prefix, 'bin/familiar')
  const entryArgs =
    process.platform === 'win32' ? [resolve(installed, 'familiar.js')] : []
  assert(
    existsSync(
      resolve(
        prefix,
        process.platform === 'win32' ? 'familiar.cmd' : 'bin/familiar',
      ),
    ),
  )
  assert.match(
    execFileSync(executable, [...entryArgs, '--help'], {
      cwd: temporary,
      env,
      encoding: 'utf8',
    }),
    /Usage: familiar/,
  )
  assert.equal(
    existsSync(env.FAMILIAR_DATA_DIR!),
    false,
    'Help must not create storage',
  )

  // An invalid installation ID stops Pi after its lazy OAuth import and
  // before it opens a callback server or sends any authentication request.
  await mkdir(env.FAMILIAR_DATA_DIR!, { recursive: true })
  if (process.platform === 'linux') {
    const deviceId = resolve(env.FAMILIAR_DATA_DIR!, 'device-id')
    await writeFile(deviceId, 'invalid-test-id')
    const signIn = spawnSync(executable, ['sign-in'], {
      cwd: temporary,
      env,
      input: '',
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(signIn.status, 1)
    assert.match(signIn.stderr, /requires a device ID/)
    await rm(deviceId)
  }

  await writeFile(
    resolve(env.FAMILIAR_DATA_DIR!, 'auth.json'),
    JSON.stringify({
      openai: {
        type: 'oauth',
        access: 'test-only',
        refresh: 'test-only',
        expires: Date.now() + 86400000,
        clientId: 'test-only',
      },
    }),
  )
  await writeFile(
    resolve(env.FAMILIAR_DATA_DIR!, 'settings.json'),
    JSON.stringify({ name: 'Release test' }),
  )
  const run = (args: string[]) =>
    execFileSync(executable, [...entryArgs, ...args], {
      cwd: temporary,
      env,
      encoding: 'utf8',
    })
  const unit = resolve(env.XDG_CONFIG_HOME!, 'systemd/user/familiar.service')
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(
        String(input),
        'https://auth.openai.com/api/accounts/oauth/token',
      )
      assert(options?.body instanceof URLSearchParams)
      assert.equal(options.body.get('grant_type'), 'refresh_token')
      return Response.json({
        access_token: 'new-test-access',
        refresh_token: 'new-test-refresh',
        expires_in: 3600,
        scope: 'chatgpt.tokens.use.direct',
      })
    }
    const { openaiChatGPTOAuth }: { openaiChatGPTOAuth: OAuthAuth } =
      await import(pathToFileURL(resolve(installed, 'openai-chatgpt.js')).href)
    const refreshed = await openaiChatGPTOAuth.refresh(
      {
        type: 'oauth',
        access: 'old',
        refresh: 'old',
        expires: 0,
        clientId: 'test-only',
      },
      new AbortController().signal,
    )
    assert.equal(refreshed.refresh, 'new-test-refresh')
    assert.deepEqual(await openaiChatGPTOAuth.toAuth(refreshed), {
      apiKey: 'new-test-access',
    })
  } finally {
    globalThis.fetch = realFetch
  }

  const InstalledPiscina: typeof import('piscina').default = createRequire(
    resolve(installed, 'package.json'),
  )('piscina')
  const pages = new InstalledPiscina({
    filename: resolve(installed, 'page-worker.js'),
    minThreads: 0,
    maxThreads: 1,
  })
  try {
    const page = await pages.run({
      html: '<main><h1>Release test</h1><a href="/more">Read more</a></main>',
      url: 'https://example.com/',
      maxChars: 1000,
    })
    assert.match(page.text, /# Release test/)
    assert.match(page.text, /\[Read more\]\(https:\/\/example.com\/more\)/)
  } finally {
    await pages.destroy()
  }

  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((done) => reservation.close(() => done()))
  const child = spawn(executable, [...entryArgs, 'serve'], {
    cwd: temporary,
    env: { ...env, FAMILIAR_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  child.stderr.pipe(process.stderr)
  try {
    const [output] = await once(child.stdout, 'data', {
      signal: AbortSignal.timeout(15000),
    })
    assert.match(
      String(output),
      new RegExp(`Release test on http://127.0.0.1:${port}`),
    )
    // Only Linux has fake OS commands here; other hosts run portable checks only.
    if (process.platform === 'linux') {
      env.FAMILIAR_PORT = String(port)
      assert.match(run([]), /Installed and started/)
      assert.match(run([]), /Settings are already saved/)
      const serviceCalls = await readFile(
        resolve(temporary, 'service-calls'),
        'utf8',
      )
      assert.equal(
        serviceCalls.match(/--user restart familiar/g)?.length,
        1,
        'Repeat setup must not restart the daemon',
      )
      assert(
        (await readFile(unit, 'utf8')).includes(`${installed}/familiar.js`),
      )

      assert.match(run(['status']), /Name: Release test/)
      assert.match(run(['rename', 'Scout']), /Renamed Release test to Scout/)
      assert.match(run(['status']), /Name: Scout/)
      assert.equal(
        JSON.parse(
          await readFile(
            resolve(env.FAMILIAR_DATA_DIR!, 'settings.json'),
            'utf8',
          ),
        ).name,
        'Scout',
      )
    }
    const url = `http://127.0.0.1:${port}`
    const page = await fetch(url, { signal: AbortSignal.timeout(5000) })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<html/)
    const asset = html.match(/src="([^"]+\.js)"/)?.[1]
    assert(asset, 'The web UI must reference its built JavaScript')
    const script = await fetch(new URL(asset, url), {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type') ?? '', /javascript/)
    assert.equal(
      (
        await fetch(`${url}/api/connections`, {
          signal: AbortSignal.timeout(5000),
        })
      ).status,
      200,
    )
    const models = await fetch(`${url}/api/model/options`, {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(models.status, 200)
    assert.deepEqual(
      (await models.json()).map(
        (option: { model: { modelId: string } }) => option.model.modelId,
      ),
      ['gpt-6.1-sol', 'gpt-6-luna'],
    )
  } finally {
    child.kill('SIGTERM')
    const forceStop = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(forceStop)
  }
  if (process.platform === 'linux') {
    assert.match(run(['uninstall']), /Your data remains/)
    assert.equal(existsSync(unit), false)
    assert.equal(
      existsSync(resolve(env.FAMILIAR_DATA_DIR!, 'familiar.sqlite')),
      true,
    )
  }
  console.log(
    `Release verified on ${process.platform}: installed CLI, OAuth refresh module, web assets, SQLite and HTML worker. ${process.platform === 'linux' ? 'Fake-service lifecycle checks also passed.' : 'Native service lifecycle remains a separate check.'}`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
