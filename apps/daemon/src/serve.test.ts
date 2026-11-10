import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { createModels } from '@familiar-ai/core/models'
import { fauxProvider } from '@familiar-ai/core/models/faux'
import { expect, onTestFinished, test, vi } from 'vitest'
import { daemonApp, OWNER_ID } from './serve.ts'
import { openDaemonWorkspace } from './workspace.ts'

async function daemon(webDir?: string) {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
    },
    'Familiar',
  )
  onTestFinished(() => workspace.dismiss())
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(familiar, OWNER_ID),
  ))!
  vi.spyOn(workspace.rooms, 'get').mockResolvedValue(dm)
  const abort = vi.spyOn(dm, 'stop')
  const app = daemonApp(workspace, { owner: 'Aidan', webDir })
  /** A Stop, which has no body, as a page or client sends it. */
  const post = (headers: Record<string, string>) =>
    app.request(`/api/rooms/${dm.id}/stop`, { method: 'POST', headers })
  return { abort, post, app }
}

const local = '127.0.0.1:4317'

test.each<[number, Record<string, string>]>([
  // A page that rebinds its own name to this machine arrives with that name.
  [401, { host: 'evil.example:4317' }],
  [401, { host: 'localhost.evil.example' }],
  [401, { host: 'ts.net.evil.example' }],
  [401, { host: 'evilts.net' }],
  [401, {}],
  // Browser posts from another site.
  [403, { host: local, origin: 'https://evil.example' }],
  [403, { host: local, 'sec-fetch-site': 'cross-site' }],
  // A sibling site may be another app on the same machine or tailnet.
  [
    403,
    {
      host: local,
      origin: 'http://127.0.0.1:8080',
      'sec-fetch-site': 'same-site',
    },
  ],
  // Sandboxed frames and files send an opaque origin.
  [403, { host: local, origin: 'null' }],
])('refuses with %i: %o', async (status, headers) => {
  const { abort, post } = await daemon()
  expect((await post(headers)).status).toBe(status)
  expect(abort).not.toHaveBeenCalled()
})

test.each<Record<string, string>>([
  // The daemon's own page.
  { host: local, origin: `http://${local}` },
  {
    host: '[::1]:4317',
    origin: 'http://[::1]:4317',
    'sec-fetch-site': 'same-origin',
  },
  // Tailscale Serve keeps the Host but terminates HTTPS, so the schemes differ.
  {
    host: 'machine.tail1234.ts.net:10000',
    origin: 'https://machine.tail1234.ts.net:10000',
  },
  // Vite's dev proxy keeps the page's Host.
  { host: 'localhost:5173', origin: 'http://localhost:5173' },
  // A proxy that rewrites the Host still passes with Sec-Fetch-Site.
  {
    host: local,
    origin: 'https://machine.tail1234.ts.net:10000',
    'sec-fetch-site': 'same-origin',
  },
  // Not a browser: the CLI, curl or a script on the owner's network.
  { host: '192.168.1.20:4317' },
])('accepts %o', async (headers) => {
  const { abort, post } = await daemon()
  expect((await post(headers)).status).toBe(202)
  expect(abort).toHaveBeenCalledOnce()
})

test("the daemon's own UI refuses to be framed", async () => {
  const webDir = mkdtempSync(join(tmpdir(), 'familiar-web-'))
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>UI</title>')
  const { app } = await daemon(webDir)

  // The page itself, and the client-side routes it answers for.
  for (const path of ['/', '/schedules']) {
    const page = await app.request(path, { headers: { host: local } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/^text\/html/)
    expect(page.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    )
    expect(page.headers.get('x-frame-options')).toBe('DENY')
  }
})
