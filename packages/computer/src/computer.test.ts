import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { openWorkspace, type Storage } from '@familiar-ai/core'
import type { JsonObject } from '@familiar-ai/core/extensions'
import { replyTo } from '@familiar-ai/core/diagnostics'
import { createModels, type Context } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { serve, upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { expect, onTestFinished, test, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { startAgent } from './agent/index.ts'
import { computerPlugin, computerRoutes, openComputers } from './index.ts'

// A paired computer end to end: a host as the daemon mounts it, on a real
// port, and the agent dialling in. The model is scripted.

/** Keeps what Familiar committed when it closes, so it can reopen. */
class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

const owner = { id: 'owner', name: 'Owner' }
const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })
/** The text of the latest tool result the model was given. */
const lastResult = (context: Context) =>
  context.messages
    .findLast((message) => message.role === 'toolResult')
    ?.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n') ?? ''

async function setup() {
  const dir = await mkdtemp(resolve(tmpdir(), 'familiar-computer-'))
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const storage = new ReopenableStorage()
  let port = 0
  let current: Awaited<ReturnType<typeof open>> | undefined

  /** The host, as the daemon is between restarts. */
  const open = async (waitMs?: number) => {
    const computers = openComputers({
      path: resolve(dir, 'computers.json'),
      keyPath: resolve(dir, 'vault.key'),
      waitMs,
    })
    const workspace = await openWorkspace({
      storage: storage as Storage,
      models,
      chatModel: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: [computerPlugin(computers)],
    })
    // The owner lets the computer act without asking each time.
    await workspace.connections.setPolicy(
      { kind: 'plugin', name: 'computer' },
      undefined,
      'allow',
    )
    const [first] = await workspace.familiars.list()
    const familiar =
      first?.id ?? (await workspace.familiars.create({ name: 'Ada' })).id
    const dm = (await workspace.rooms.get(
      await workspace.rooms.dm(familiar, owner.id),
    ))!
    const sockets = new WebSocketServer({ noServer: true })
    const app = new Hono().route(
      '/api/computers',
      computerRoutes(computers, { workspace, upgradeWebSocket }),
    )
    const server = serve({
      fetch: app.fetch,
      hostname: '127.0.0.1',
      port,
      websocket: { server: sockets },
    }) as Server
    await once(server, 'listening')
    port = (server.address() as AddressInfo).port
    const close = async () => {
      await workspace.dismiss()
      sockets.clients.forEach((socket) => socket.terminate())
      server.close()
      await computers.close()
    }
    return { familiar, dm, close }
  }

  current = await open(300)
  const agents: ReturnType<typeof startAgent>[] = []
  onTestFinished(async () => {
    await Promise.all(agents.map((agent) => agent.stop()))
    await current?.close()
    await rm(dir, { recursive: true, force: true })
  })

  return {
    faux,
    dir,
    host: () => current!,
    /** Stops the host as a restart would, mid-call, and opens it again. */
    restart: async () => {
      await current!.close()
      current = await open()
      return current
    },
    /** Gives the Familiar a computer: its pairing link. */
    pair: async () => {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/computers/${current!.familiar}`,
        { method: 'POST' },
      )
      return ((await response.json()) as { link: string }).link
    },
    /** Runs the computer's agent, with `dir` as its home, until it's online. */
    run: async (link: string) => {
      agents.push(
        startAgent({ link, dataDir: resolve(dir, 'agent'), home: dir }),
      )
      await vi.waitFor(async () => {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/computers/${current!.familiar}`,
        )
        expect(await response.json()).toEqual({ status: 'online' })
      }, 10_000)
    },
    /** Posts `text` and waits for the reply. */
    ask: async (text: string) => {
      const { dm } = current!
      const entry = await dm.post({ author: owner, text, requestId: text })
      return { entry, reply: () => replyTo(current!.dm, entry) }
    },
  }
}

test('an action cut off by a host restart is reported, not run again, and the computer reconnects', async () => {
  const { faux, dir, ask, pair, run, restart } = await setup()
  const results: string[] = []
  const note = (next: ReturnType<typeof call>) => (context: Context) => {
    results.push(lastResult(context))
    return next
  }

  // Paired, but the machine isn't running the agent yet.
  const link = await pair()
  faux.setResponses([
    call('read_file', { path: 'notes.txt' }),
    note(fauxAssistantMessage('Offline.')),
  ])
  await (await ask('Before running')).reply()
  expect(results.splice(0)).toEqual([expect.stringMatching(/offline/)])
  await run(link)

  // An action is under way on the computer when the host stops.
  faux.setResponses([
    call('run_command', { command: 'echo ran >> runs.txt; sleep 60' }),
  ])
  const task = await ask('Run it')
  const runs = resolve(dir, 'runs.txt')
  await vi.waitFor(() => expect(existsSync(runs)).toBe(true), {
    timeout: 10_000,
  })
  faux.setResponses([
    note(call('read_file', { path: 'runs.txt' })),
    note(fauxAssistantMessage('Done.')),
  ])
  await restart()
  await task.reply()

  expect(results[0]).toMatch(/interrupted/)
  // Read through the agent once it reconnected: the action ran once.
  expect(results[1]).toBe('ran\n')
  expect(readFileSync(runs, 'utf8')).toBe('ran\n')
}, 30_000)

test.skipIf(!existsSync(chromium.executablePath()))(
  'a Familiar uses a web page on its computer',
  async () => {
    const page = createServer((_request, response) =>
      response.end(`<!doctype html><title>Greeter</title>
<label>Name <input></label>
<button onclick="document.querySelector('p').textContent = 'Hello, ' + document.querySelector('input').value">Greet</button>
<p></p>`),
    ).listen(0, '127.0.0.1')
    await once(page, 'listening')
    onTestFinished(() => void page.close())
    const url = `http://127.0.0.1:${(page.address() as AddressInfo).port}/`

    const { faux, ask, pair, run } = await setup()
    await run(await pair())
    const ref = (context: Context, element: RegExp) =>
      lastResult(context).match(element)?.[1] ?? 'missing'
    let final = ''
    faux.setResponses([
      call('browser_navigate', { url }),
      (context) =>
        call('browser_type', {
          ref: ref(context, /textbox "Name" \[ref=(\w+)\]/),
          text: 'Ada',
        }),
      (context) =>
        call('browser_click', {
          ref: ref(context, /button "Greet" \[ref=(\w+)\]/),
        }),
      (context) => {
        final = lastResult(context)
        return fauxAssistantMessage('It says hello.')
      },
    ])
    await (await ask('Greet Ada')).reply()
    expect(final).toContain('Hello, Ada')
  },
  60_000,
)
