import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import {
  definePlugin,
  upgradeWebSocket,
  type PluginEnv,
} from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import { fauxProvider } from '@familiar-ai/core/models/faux'
import { computer, type ComputerHost } from '@familiar-ai/computer'
import { Hono } from 'hono'
import { expect, onTestFinished, test, vi } from 'vitest'
import { WebSocket } from 'ws'
import { settingsComputerLimit } from './computer-limit.ts'
import { daemonApp, listen, OWNER_ID, type ServeOptions } from './serve.ts'
import { openDaemonWorkspace } from './workspace.ts'

async function daemon(
  options: Pick<
    ServeOptions,
    'webDir' | 'avatarsDir' | 'models' | 'computerLimit'
  > = {},
) {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
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
  const app = daemonApp(workspace, { owner: 'Aidan', ...options })
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
  const { app } = await daemon({ webDir })

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

test("the owner's portraits are listed and served, and nothing outside them", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'familiar-data-'))
  const avatarsDir = join(dataDir, 'avatars')
  mkdirSync(avatarsDir)
  writeFileSync(join(avatarsDir, '042.png'), 'strip')
  writeFileSync(join(avatarsDir, 'notes.txt'), 'not a portrait')
  writeFileSync(join(dataDir, 'secret.png'), 'private')
  const { app } = await daemon({ avatarsDir })
  const get = (path: string) => app.request(path, { headers: { host: local } })

  expect(await (await get('/api/avatars')).json()).toEqual({
    folder: avatarsDir,
    names: ['042'],
  })
  const strip = await get('/api/avatars/042.png')
  expect(strip.headers.get('content-type')).toBe('image/png')
  expect(await strip.text()).toBe('strip')
  for (const path of [
    '/api/avatars/..%2Fsecret.png',
    '/api/avatars/%2E%2E%2Fsecret.png',
    '/api/avatars/missing.png',
  ]) {
    expect((await get(path)).status).toBe(404)
  }
})

test("provider keys are saved write-only, only by the owner's network", async () => {
  // Pi also finds a key in the environment, as a developer's may have.
  for (const name of ['API_KEY', 'AUTH_TOKEN', 'OAUTH_TOKEN']) {
    vi.stubEnv(`ANTHROPIC_${name}`, '')
  }
  const models = createModels()
  models.setProvider(openaiProvider())
  models.setProvider(anthropicProvider())
  const { app } = await daemon({ models })
  const send = (method: string, path: string, host = local, body?: object) =>
    app.request(`/api/providers${path}`, {
      method,
      headers: { host, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    })
  const listed = async () => (await send('GET', '')).json()

  expect(
    (await send('PUT', '/anthropic/key', 'evil.example', { key: 'k' })).status,
  ).toBe(401)
  // OpenAI's credential is the ChatGPT sign-in.
  expect((await send('PUT', '/openai/key', local, { key: 'k' })).status).toBe(
    404,
  )
  expect(await listed()).toEqual([
    { id: 'anthropic', name: 'Anthropic', set: false },
  ])

  expect(
    (await send('PUT', '/anthropic/key', local, { key: ' sk-test ' })).status,
  ).toBe(204)
  expect(await models.getAuth('anthropic')).toMatchObject({
    auth: { apiKey: 'sk-test' },
  })
  expect(await listed()).toEqual([
    { id: 'anthropic', name: 'Anthropic', set: true },
  ])

  expect((await send('DELETE', '/anthropic/key')).status).toBe(204)
  expect(await listed()).toEqual([
    { id: 'anthropic', name: 'Anthropic', set: false },
  ])
})

test("the computer limit is saved in settings.json, only by the owner's network", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'familiar-limit-'))
  onTestFinished(() => rmSync(dataDir, { recursive: true }))
  const settings = join(dataDir, 'settings.json')
  writeFileSync(settings, JSON.stringify({ name: 'Cat' }))
  const { app } = await daemon({
    computerLimit: settingsComputerLimit(dataDir),
  })
  const send = (method: string, host = local, body?: object) =>
    app.request('/api/computer-limit', {
      method,
      headers: { host, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    })

  expect(await (await send('GET')).json()).toEqual({ maxComputers: 10 })
  expect((await send('PUT', 'evil.example', { maxComputers: 3 })).status).toBe(
    401,
  )
  expect((await send('PUT', local, { maxComputers: -1 })).status).toBe(400)
  expect((await send('PUT', local, { maxComputers: 3 })).status).toBe(204)
  expect(await (await send('GET')).json()).toEqual({ maxComputers: 3 })
  // The installation's other choices stay.
  expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({
    name: 'Cat',
    maxComputers: 3,
  })
})

test("plugins' WebSocket routes echo, behind the owner's network and same origin", async () => {
  const routes = new Hono<PluginEnv>().get(
    '/echo',
    upgradeWebSocket(() => ({
      onMessage: (event, ws) => ws.send(event.data as string),
    })),
  )
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [
        definePlugin({ name: 'echo', title: 'Echo', tools: [], routes }),
      ],
    },
    'Familiar',
  )
  onTestFinished(() => workspace.dismiss())
  const server = listen(daemonApp(workspace, { owner: 'Aidan' }), {
    host: '127.0.0.1',
    port: 0,
  })
  onTestFinished(() => void server.close())
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const url = `ws://127.0.0.1:${port}/api/plugins/echo/familiars/${familiar}/echo`

  /** The status the upgrade was refused with, or the echo if it opened. */
  const open = (headers: Record<string, string>) =>
    new Promise<number | string>((resolve) => {
      const socket = new WebSocket(url, { headers })
      socket.on('unexpected-response', (_, response) =>
        resolve(response.statusCode!),
      )
      socket.on('open', () => socket.send('hello'))
      socket.on('message', (data) => {
        resolve(String(data))
        socket.close()
      })
    })

  expect(await open({ origin: `http://127.0.0.1:${port}` })).toBe('hello')
  expect(await open({})).toBe('hello')
  expect(await open({ origin: 'https://evil.example' })).toBe(403)
  expect(await open({ host: 'evil.example' })).toBe(401)
})

test("a computer's screen streams over its socket, which owns it", async () => {
  /** Each viewer's stream: an echo, opened with a banner, and its signal. */
  const viewers: { signal: AbortSignal; end: () => void }[] = []
  let running = true
  const host: ComputerHost = {
    screen: async (_familiar, signal) => {
      if (!running) {
        return undefined
      }
      let screen!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>
      const readable = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: (controller) => {
          screen = controller
          controller.enqueue(new TextEncoder().encode('RFB'))
        },
      })
      const writable = new WritableStream<Uint8Array<ArrayBuffer>>({
        write: (bytes) => screen.enqueue(bytes),
      })
      viewers.push({ signal, end: () => screen.close() })
      return { readable, writable }
    },
    call: async () => ({ content: [] }),
    control: async () => {
      throw new Error('Not here.')
    },
    sync: async () => {},
    status: async () => ({ state: 'running' }),
    inspect: async () => ({}),
    summary: async () => ({ computers: [] }),
    close: async () => {},
  }
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [computer({ host })],
      defaultCapabilities: { plugins: ['computer'] },
    },
    'Familiar',
  )
  onTestFinished(() => workspace.dismiss())
  const server = listen(daemonApp(workspace, { owner: 'Aidan' }), {
    host: '127.0.0.1',
    port: 0,
  })
  onTestFinished(() => void server.close())
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const watch = () => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/plugins/computer/familiars/${familiar}/screen`,
    )
    const received: string[] = []
    socket.on('message', (data) => received.push(String(data)))
    const closed = once(socket, 'close').then(([code]) => code as number)
    return { socket, received, closed }
  }

  // Bytes go both ways; closing the socket ends the stream.
  const first = watch()
  await vi.waitFor(() => expect(first.received).toEqual(['RFB']))
  first.socket.send(Buffer.from('hi'))
  await vi.waitFor(() => expect(first.received).toEqual(['RFB', 'hi']))
  first.socket.close()
  await vi.waitFor(() => expect(viewers[0]!.signal.aborted).toBe(true))

  // The stream ending, as the computer stops, closes the socket.
  const second = watch()
  await vi.waitFor(() => expect(second.received).toEqual(['RFB']))
  viewers[1]!.end()
  expect(await second.closed).toBe(1000)

  // A computer that isn't running closes it at once.
  running = false
  expect(await watch().closed).toBe(1000)
})

test("a person's control lasts as long as their socket", async () => {
  /** Each take-over's signal, and how to end it from the computer's side. */
  const holds: { signal: AbortSignal; end: () => void }[] = []
  /** Why the computer refuses a take-over, once it does. */
  const refusal: { reason?: string } = {}
  const host: ComputerHost = {
    control: async (_familiar, signal) => {
      if (refusal.reason) {
        throw new Error(refusal.reason)
      }
      let end!: () => void
      const ended = new Promise<void>((resolve) => {
        end = resolve
        signal.addEventListener('abort', () => resolve())
      })
      holds.push({ signal, end })
      return { ended }
    },
    screen: async () => undefined,
    call: async () => ({ content: [] }),
    sync: async () => {},
    status: async () => ({ state: 'running' }),
    inspect: async () => ({}),
    summary: async () => ({ computers: [] }),
    close: async () => {},
  }
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [computer({ host })],
      defaultCapabilities: { plugins: ['computer'] },
    },
    'Familiar',
  )
  onTestFinished(() => workspace.dismiss())
  const server = listen(daemonApp(workspace, { owner: 'Aidan' }), {
    host: '127.0.0.1',
    port: 0,
  })
  onTestFinished(() => void server.close())
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const takeOver = () => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/plugins/computer/familiars/${familiar}/control`,
    )
    const received: string[] = []
    socket.on('message', (data) => received.push(String(data)))
    const closed = once(socket, 'close').then(([code, reason]) => [
      code as number,
      String(reason),
    ])
    return { socket, received, closed }
  }

  // Held, then handed back by closing the socket.
  const first = takeOver()
  await vi.waitFor(() => expect(first.received).toEqual(['held']))
  first.socket.close()
  await vi.waitFor(() => expect(holds[0]!.signal.aborted).toBe(true))

  // Control ending on the computer's side closes the socket.
  const second = takeOver()
  await vi.waitFor(() => expect(second.received).toEqual(['held']))
  holds[1]!.end()
  expect(await second.closed).toEqual([1000, 'Control ended.'])

  // Refused: closed with why.
  refusal.reason = 'Someone else is using this computer.'
  expect(await takeOver().closed).toEqual([4000, refusal.reason])
})
