import { once } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { chromium } from 'playwright'
import { expect, onTestFinished, test, vi } from 'vitest'
import { startAgent } from './agent/index.ts'
import { openComputers } from './index.ts'
import {
  call,
  lastResult,
  ReopenableStorage,
  serveHost,
  testModel,
} from './testing.ts'

const PASSWORD = 'correct-horse-7319'

/** Everything Familiar ever commits, which includes what clients stream. */
class WatchedStorage extends ReopenableStorage {
  written: string[] = []
  override commit(...args: Parameters<ReopenableStorage['commit']>) {
    this.written.push(
      JSON.stringify(args[0], (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    )
    return super.commit(...args)
  }
}

/**
 * A site on 127.0.0.1 whose sign-in echoes the password back, a page
 * framing the same form from localhost, another origin, and one framing it
 * in a sandbox, which gives the frame no origin of its own though its
 * address is the site's.
 */
async function serveSite() {
  const posted: string[] = []
  const site = createServer((request, response) => {
    const { port } = site.address() as AddressInfo
    response.setHeader('content-type', 'text/html')
    if (request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        posted.push(body)
        const password = new URLSearchParams(body).get('pass')
        response.end(
          `<!doctype html><title>Home</title><h1>Welcome, sam</h1><p>You signed in with ${password}</p>`,
        )
      })
      return
    }
    response.end(
      request.url === '/framed'
        ? `<!doctype html><title>Framed</title><iframe src="http://localhost:${port}/login"></iframe>`
        : request.url === '/sandboxed'
          ? `<!doctype html><title>Sandboxed</title><iframe sandbox="allow-forms allow-scripts" src="/login"></iframe>`
          : `<!doctype html><title>Sign in</title><form method="post" action="/session">
<label>Email <input type="email" name="user"></label>
<label>Password <input type="password" name="pass"></label>
<button>Sign in</button></form>`,
    )
  }).listen(0, '127.0.0.1')
  await once(site, 'listening')
  onTestFinished(() => void site.close())
  return {
    origin: `http://127.0.0.1:${(site.address() as AddressInfo).port}`,
    posted,
  }
}

test.skipIf(!existsSync(chromium.executablePath()))(
  'a Familiar signs in with a login the person entered privately, never seeing the password, and never into another origin',
  async () => {
    const { origin, posted } = await serveSite()
    const dir = await mkdtemp(resolve(tmpdir(), 'familiar-sign-in-'))
    const { faux, models } = testModel()
    const storage = new WatchedStorage()
    const host = await serveHost({
      computers: openComputers({
        path: resolve(dir, 'computers.json'),
        loginsDir: resolve(dir, 'logins'),
        keyPath: resolve(dir, 'vault.key'),
      }),
      models,
      storage,
    })
    const { link } = (await (
      await host.api('', { method: 'POST' })
    ).json()) as { link: string }
    const agent = startAgent({
      link,
      dataDir: resolve(dir, 'agent'),
      home: dir,
    })
    onTestFinished(async () => {
      await agent.stop()
      await host.close()
      await rm(dir, { recursive: true, force: true })
    })
    await vi.waitFor(
      async () => expect(await host.status()).toBe('online'),
      10_000,
    )

    const results: string[] = []
    const then = (next: ReturnType<typeof call>) => (context: Context) => {
      results.push(lastResult(context))
      return next
    }
    faux.setResponses([
      call('request_login', { site: `${origin}/login` }),
      then(call('browser_navigate', { url: `${origin}/framed` })),
      then(call('sign_in', { site: origin })),
      then(call('browser_navigate', { url: `${origin}/sandboxed` })),
      then(call('sign_in', { site: origin })),
      then(call('browser_navigate', { url: `${origin}/login` })),
      then(call('sign_in', { site: origin })),
      then(fauxAssistantMessage('Signed in.')),
      // After the person deletes the login.
      call('browser_snapshot', {}),
      then(fauxAssistantMessage('Looked.')),
    ])
    const entry = await host.ask('Sign in to the site')
    const question = await host.answer({
      username: 'sam@example.com',
      password: PASSWORD,
    })
    await host.reply(entry)

    // The form named the exact site.
    expect(question).toMatchObject({ kind: 'private' })
    expect(JSON.stringify(question)).toContain(origin)
    const [saved, , refused, , sandboxed, , signedIn] = results
    expect(saved).toContain(`saved a login for ${origin}`)
    // The form framed from localhost is another origin: nothing was filled.
    expect(refused).toMatch(
      /^Refused: the sign-in form is on http:\/\/localhost:/,
    )
    // Nor in a sandboxed frame at the site's own address.
    expect(sandboxed).toMatch(
      /^Refused: the sign-in form is on a page with no origin of its own/,
    )
    // Filled and submitted on the site itself, once.
    expect(posted).toEqual([`user=sam%40example.com&pass=${PASSWORD}`])
    expect(signedIn).toMatch(/^Signed in to http:\/\/127\.0\.0\.1:/)
    // The page echoing the password reached the model without it.
    expect(signedIn).toContain('You signed in with [saved password]')

    // Nowhere the model, the chat or storage sees it, nor the routes, nor
    // the file on disk.
    expect(results.join('\n')).not.toContain(PASSWORD)
    expect(storage.written.join('\n')).not.toContain(PASSWORD)
    const logins = await (await host.api('/logins')).text()
    expect(JSON.parse(logins)).toEqual([
      { site: origin, username: 'sam@example.com' },
    ])
    expect(logins).not.toContain(PASSWORD)
    const [file] = readdirSync(resolve(dir, 'logins'))
    expect(readFileSync(resolve(dir, 'logins', file!), 'utf8')).not.toContain(
      PASSWORD,
    )

    // A deleted login's password is still removed from the page echoing it.
    await host.api(`/logins?site=${encodeURIComponent(origin)}`, {
      method: 'DELETE',
    })
    await host.reply(await host.ask('Look at the page'))
    expect(results.at(-1)).toContain('You signed in with [saved password]')
    expect(results.join('\n')).not.toContain(PASSWORD)

    // Its logins go with the computer.
    await host.api('', { method: 'DELETE' })
    expect(readdirSync(resolve(dir, 'logins'))).toEqual([])
  },
  60_000,
)
