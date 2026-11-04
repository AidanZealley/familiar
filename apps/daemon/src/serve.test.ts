import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { summonFamiliar, type Familiar } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { createModels } from '@familiar-ai/core/models'
import { fauxProvider } from '@familiar-ai/core/models/faux'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { daemonApp, isAllowedHost } from './serve.ts'

test.each([
  '127.0.0.1:4317',
  'localhost:4317',
  '[::1]:4317',
  '192.168.1.20:5174',
  'machine.tail1234.ts.net:10000',
])('accepts %s', (host) => {
  expect(isAllowedHost(host)).toBe(true)
})

// A page that rebinds its own name to this machine arrives with that name.
test.each([
  'evil.example:4317',
  'localhost.evil.example',
  'ts.net.evil.example',
  '',
  null,
])('refuses %s', (host) => {
  expect(isAllowedHost(host)).toBe(false)
})

describe('browser mutations', () => {
  const opened: Familiar[] = []
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
  })

  async function daemon() {
    const models = createModels()
    models.setProvider(fauxProvider().provider)
    const familiar = await summonFamiliar({
      storage: new MemoryStorage(),
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
    })
    opened.push(familiar)
    const abort = vi.spyOn(familiar, 'abort')
    const app = daemonApp(familiar, { owner: 'Aidan' })
    /** A POST to /api/abort, which has no body, as a page or client sends it. */
    const post = (headers: Record<string, string>, body?: string) =>
      app.request('/api/abort', { method: 'POST', headers, body })
    return { abort, post, app }
  }

  const local = { host: '127.0.0.1:4317' }

  test.each<Record<string, string>>([
    { origin: 'https://evil.example' },
    { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    // A sibling site may be another app on the same machine or tailnet.
    { origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-site' },
    // Sandboxed frames and files send an opaque origin.
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
  ])('a bodyless POST from another site is refused: %o', async (headers) => {
    const { abort, post } = await daemon()
    expect((await post({ ...local, ...headers })).status).toBe(403)
    expect(abort).not.toHaveBeenCalled()
  })

  test.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'a %s form post from another site is refused',
    async (type) => {
      const { abort, post } = await daemon()
      const response = await post(
        { ...local, origin: 'https://evil.example', 'content-type': type },
        'x=1',
      )
      expect(response.status).toBe(403)
      expect(abort).not.toHaveBeenCalled()
    },
  )

  test('JSON from another site gets no CORS grant, so a browser never sends it', async () => {
    const { app } = await daemon()
    const preflight = await app.request('/api/messages', {
      method: 'OPTIONS',
      headers: {
        ...local,
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  test.each<Record<string, string>>([
    // The daemon's own page.
    { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317' },
    {
      host: '127.0.0.1:4317',
      origin: 'http://127.0.0.1:4317',
      'sec-fetch-site': 'same-origin',
    },
    // Tailscale Serve keeps the Host but terminates HTTPS, so the schemes differ.
    {
      host: 'machine.tail1234.ts.net:10000',
      origin: 'https://machine.tail1234.ts.net:10000',
    },
    // Vite's dev proxy keeps the page's Host.
    { host: '100.101.102.103:5173', origin: 'http://100.101.102.103:5173' },
    // A proxy that rewrites the Host still passes with Sec-Fetch-Site.
    {
      host: '127.0.0.1:4317',
      origin: 'https://machine.tail1234.ts.net:10000',
      'sec-fetch-site': 'same-origin',
    },
    // Not a browser: the CLI, curl or a script on the owner's network.
    { host: '127.0.0.1:4317' },
  ])('a same-origin or non-browser POST is accepted: %o', async (headers) => {
    const { abort, post } = await daemon()
    expect((await post(headers)).status).toBe(202)
    expect(abort).toHaveBeenCalledOnce()
  })
})

test("the daemon's own UI refuses to be framed; an embedding host's API sets no framing policy", async () => {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
  })
  onTestFinished(() => familiar.dismiss())
  const webDir = mkdtempSync(join(tmpdir(), 'familiar-web-'))
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>UI</title>')
  const app = daemonApp(familiar, { owner: 'Aidan', webDir })
  const framing = (response: Response) => [
    response.headers.get('content-security-policy'),
    response.headers.get('x-frame-options'),
  ]

  // The page itself, and the client-side routes it answers for.
  for (const path of ['/', '/schedules']) {
    const page = await app.request(path, { headers: { host: '127.0.0.1' } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/^text\/html/)
    expect(framing(page)).toEqual(["frame-ancestors 'none'", 'DENY'])
  }

  // Embedded hosts serve Familiar's API inside their own pages and keep
  // their own framing policy.
  const embedded = createHttpApi(familiar, {
    authenticate: () => ({ id: 'sam', name: 'Sam' }),
    routes: { memory: { health: true } },
  })
  expect(framing(await embedded.request('/memory/health'))).toEqual([
    null,
    null,
  ])
})
