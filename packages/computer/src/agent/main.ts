#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import {
  connect,
  createServer,
  type ListenOptions,
  type Server,
} from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { activity } from './activity.ts'
import { openBrowser } from './browser.ts'
import { computerControl } from './control.ts'
import { startDisplay } from './display.ts'
import { computerServer } from './server.ts'
import { AGENT_SOCKET, PROXY_PORT } from './socket.ts'

// The computer agent, the image's entrypoint: serves the computer's tools
// over MCP on a Unix socket, one server per connection, as newline-delimited
// JSON-RPC (MCP's stdio framing). It only listens: `dockerHost` reaches in
// with `docker exec` running `socat`. The browser outlives connections, so a
// new connection finds its pages as they were.
//
// It owns the display: it starts it before it listens, and ends if it goes,
// so the computer is never running without one; the next call starts it
// again.
//
// With --idle-ms, it ends itself once that long passes with no call (a look
// at it doesn't count), which stops its container: the computer sleeps.
//
// With --proxy-socket, for a computer with no network of its own, it passes
// each connection to 127.0.0.1:PROXY_PORT on to that proxy's Unix socket, so
// HTTP_PROXY and HTTPS_PROXY can point there.

const { values } = parseArgs({
  options: {
    'idle-ms': { type: 'string' },
    'proxy-socket': { type: 'string' },
  },
})

const listen = (server: Server, at: ListenOptions) =>
  new Promise<void>((done, fail) => server.once('error', fail).listen(at, done))

// First, so a taken port fails the start before anything else is open.
const proxySocket = values['proxy-socket']
const proxy =
  proxySocket === undefined
    ? undefined
    : createServer((local) => {
        const onward = connect(proxySocket)
        local.on('error', () => onward.destroy())
        onward.on('error', () => local.destroy())
        local.pipe(onward).pipe(local)
      })
if (proxy) {
  await listen(proxy, { port: PROXY_PORT, host: '127.0.0.1' })
}

// Without its display, the browser has gone too: nothing is left to close.
await startDisplay((reason) => {
  console.error(`${reason} Stopping.`)
  process.exit(1)
})

const home = homedir()
const control = computerControl()
const browser = openBrowser(resolve(home, '.familiar-computer', 'browser'))
// A socket left by an agent that stopped.
await rm(AGENT_SOCKET, { force: true })
const server = createServer((socket) => {
  // A connection that drops ends its server, which stops its calls.
  socket.on('error', () => socket.destroy())
  void computerServer(browser, home, calls, control).connect(
    new StdioServerTransport(socket, socket),
  )
})
await listen(server, { path: AGENT_SOCKET })
// Its idle time starts now, before any connection can come in.
const idleMs = values['idle-ms']
const calls = activity(
  idleMs === undefined ? undefined : Number(idleMs),
  () => void stop(),
)
console.log(`Listening on ${AGENT_SOCKET}.`)

async function stop() {
  server.close()
  proxy?.close()
  await browser.close()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
