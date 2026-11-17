import { once } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { FamiliarId } from '@familiar-ai/core'
import type { Context } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { chromium } from 'playwright'
import { expect, onTestFinished, test, vi } from 'vitest'
import { startAgent } from './agent/index.ts'
import { computerLogins, redact } from './host/logins.ts'
import { openComputers } from './index.ts'
import { KEEP_TEXT, shorten } from './shorten.ts'
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

const FORM = `<!doctype html><title>Sign in</title><form method="post" action="/session">
<label>Email <input type="email" name="user"></label>
<label>Password <input type="password" name="pass"></label>
<button>Sign in</button></form>`

/** The form, with a script claiming `origin` every way the page can. */
const forged = (origin: string) =>
  `<script>
for (const name of ['origin', '__familiarOrigin']) {
  Object.defineProperty(window, name, { get: () => '${origin}' })
}
</script>${FORM}`.replaceAll('"', '&quot;')

/**
 * A site on 127.0.0.1 whose sign-in echoes the password back, a page
 * framing the same form from localhost, another origin, and one framing it
 * in a sandbox, which gives the frame no origin of its own though its
 * address is the site's, and one framing it in a sandbox from a script
 * that claims the site's origin.
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
          : request.url === '/scripted'
            ? `<!doctype html><title>Scripted</title><iframe sandbox="allow-forms allow-scripts" srcdoc="${forged(`http://127.0.0.1:${port}`)}"></iframe>`
            : FORM,
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
      then(call('browser_navigate', { url: `${origin}/scripted` })),
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
    const [saved, , refused, , sandboxed, , scripted, , signedIn] = results
    expect(saved).toContain(`saved a login for ${origin}`)
    // The form framed from localhost is another origin: nothing was filled.
    expect(refused).toMatch(
      /^Refused: the sign-in form is on http:\/\/localhost:/,
    )
    // Nor in a sandboxed frame at the site's own address, nor in one whose
    // script claims the site's origin.
    for (const result of [sandboxed, scripted]) {
      expect(result).toMatch(
        /^Refused: the sign-in form is on a page with no origin of its own/,
      )
    }
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

test('a password the computer cut through leaves no piece at either edge, even once redaction shortens the result', () => {
  // Long, so replacing each copy brings the result under the limit.
  const password = Array.from({ length: 10 }, (_, i) => `piece${i}`).join('-')
  const echoed = `${password} `.repeat(KEEP_TEXT)
  // Cut as a page is (its start kept) and as command output is (its end),
  // each through a password.
  const page = echoed.slice(0, KEEP_TEXT)
  const output = echoed.slice(-KEEP_TEXT)
  const [cutEnd, cutStart] = [page.split(' ').at(-1)!, output.split(' ')[0]!]
  expect([cutEnd, cutStart]).not.toContain(password)
  expect(password.startsWith(cutEnd) && password.endsWith(cutStart)).toBe(true)
  for (const [text, keep] of [
    [page, 'start'],
    [output, 'end'],
  ] as const) {
    const shown = shorten(redact(text, [password]), keep)
    expect(shown).toBe(redact(text, [password]))
    expect(shown).not.toMatch(/piec|iece|ece\d|-pie|\d-p/)
  }
  // Ordinary text at an edge, even a piece of a password too short to tell, stays.
  expect(redact('piece of text, iec', [password])).toBe('piece of text, iec')
})

test("a saved login's password is still removed after the host restarts and it's replaced or deleted", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'familiar-logins-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const familiar = 1 as FamiliarId
  const open = () => computerLogins(resolve(dir, 'logins'), resolve(dir, 'key'))
  const first = open()
  first.set(familiar, 'https://a.example', {
    username: 'sam',
    password: 'first-pass-1',
  })
  first.set(familiar, 'https://b.example', {
    username: 'sam',
    password: 'second-pass-2',
  })

  const restarted = open()
  restarted.set(familiar, 'https://a.example', {
    username: 'sam',
    password: 'new-pass-3',
  })
  restarted.delete(familiar, 'https://b.example')
  expect(
    restarted.scrub(familiar, 'first-pass-1 second-pass-2 new-pass-3'),
  ).toBe('[saved password] [saved password] [saved password]')
})
