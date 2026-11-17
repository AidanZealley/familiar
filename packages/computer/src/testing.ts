import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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
import { WebSocketServer } from 'ws'
import type { Computers } from './host/computers.ts'
import { computerPlugin, computerRoutes } from './index.ts'

// A host as the daemon mounts computers, on a real port, for the package's
// tests. The model is scripted.

/** Keeps what Familiar committed when it closes, so it can reopen. */
export class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

const owner = { id: 'owner', name: 'Owner' }

/** The model calling a computer tool. */
export const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/** The text of the latest tool result the model was given. */
export const lastResult = (context: Context) =>
  context.messages
    .findLast((message) => message.role === 'toolResult')
    ?.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n') ?? ''

export function testModel() {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

/**
 * Opens a workspace with one Familiar, Ada, whose computer tools run
 * without asking, and serves `/api/computers` on `hostname:port` (any free
 * port for 0).
 */
export async function serveHost(options: {
  computers: Computers
  models: ReturnType<typeof testModel>['models']
  storage: ReopenableStorage
  hostname?: string
  port?: number
}) {
  const { computers } = options
  const workspace = await openWorkspace({
    storage: options.storage as Storage,
    models: options.models,
    chatModel: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    plugins: [computerPlugin(computers)],
  })
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
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 0,
    websocket: { server: sockets },
  }) as Server
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const api = (path = '', init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}/api/computers/${familiar}${path}`, init)

  return {
    workspace,
    familiar,
    port,
    /** Ada's computer routes, as the owner calls them. */
    api,
    status: async () =>
      ((await (await api()).json()) as { status: string }).status,
    /** Posts `text` to Ada; `reply` waits for her answer to it. */
    ask: (text: string) => dm.post({ author: owner, text, requestId: text }),
    reply: (entry: Awaited<ReturnType<typeof dm.post>>) => replyTo(dm, entry),
    close: async () => {
      await workspace.dismiss()
      sockets.clients.forEach((socket) => socket.terminate())
      server.close()
      await computers.close()
    },
  }
}

/** A page with a name field and a button that greets the name. */
export const GREETER = `<!doctype html><title>Greeter</title>
<label>Name <input></label>
<button onclick="document.querySelector('p').textContent = 'Hello, ' + document.querySelector('input').value">Greet</button>
<p></p>`

/** The model's calls to greet Ada on the greeter page at `url`. */
export function greet(url: string) {
  const ref = (context: Context, element: RegExp) =>
    lastResult(context).match(element)?.[1] ?? 'missing'
  return [
    call('browser_navigate', { url }),
    (context: Context) =>
      call('browser_type', {
        ref: ref(context, /textbox "Name" \[ref=(\w+)\]/),
        text: 'Ada',
      }),
    (context: Context) =>
      call('browser_click', {
        ref: ref(context, /button "Greet" \[ref=(\w+)\]/),
      }),
  ]
}
