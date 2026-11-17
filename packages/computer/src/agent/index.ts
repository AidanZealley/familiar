import { rm } from 'node:fs/promises'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { openBrowser } from './browser.ts'
import { computerServer } from './server.ts'
import { PROXY_PORT } from './socket.ts'

export { AGENT_SOCKET, PROXY_PORT } from './socket.ts'

export type AgentOptions = {
  /** Where the agent keeps the browser's profile. */
  dataDir: string
  /** Where commands run and relative paths start. Default the user's home. */
  home?: string
  /**
   * A proxy's Unix socket, for a computer with no network of its own: the
   * agent passes each connection to 127.0.0.1:`PROXY_PORT` on to it, so
   * `HTTP_PROXY` and `HTTPS_PROXY` can point there.
   */
  proxySocket?: string
} & (
  | {
      /** A Unix socket, as newline-delimited JSON-RPC (MCP's stdio framing). */
      socket: string
    }
  | {
      /** A TCP port on every interface, as MCP's Streamable HTTP. */
      port: number
    }
)

/**
 * Runs the computer agent: serves the computer's tools over MCP, on a Unix
 * socket with one server per connection (for `dockerHost`, which reaches in
 * with `docker exec` and `socat`), or over HTTP with one per request (for
 * `cloudflareContainers`, which reaches in through the container's port).
 * It only listens. The browser outlives connections and requests, so each
 * finds its pages as they were.
 */
export async function startAgent(options: AgentOptions) {
  // First, so a taken port fails the start before anything else is open.
  const proxy = options.proxySocket
    ? await passOn(options.proxySocket)
    : undefined
  const browser = openBrowser(resolve(options.dataDir, 'browser'))
  const home = options.home ?? homedir()
  const server =
    'socket' in options
      ? await listenOnSocket(options.socket, (socket) => {
          // A connection that drops ends its server, which stops its calls.
          socket.on('error', () => socket.destroy())
          void computerServer(browser, home).connect(
            new StdioServerTransport(socket, socket),
          )
        })
      : await listenOnPort(
          options.port,
          // MCP's per-request revision only, where a request that drops
          // stops its call (see `cloudflareContainers`).
          createMcpHandler(() => computerServer(browser, home), {
            legacy: 'reject',
          }).fetch,
        )
  return {
    stop: async () => {
      server.close()
      proxy?.close()
      await browser.close()
    },
  }
}

/** Passes each connection to 127.0.0.1:`PROXY_PORT` on to `socket`. */
async function passOn(socket: string) {
  const server = createServer((local) => {
    const onward = connect(socket)
    local.on('error', () => onward.destroy())
    onward.on('error', () => local.destroy())
    local.pipe(onward).pipe(local)
  })
  await new Promise<void>((done, fail) =>
    server.once('error', fail).listen(PROXY_PORT, '127.0.0.1', done),
  )
  return server
}

async function listenOnSocket(
  path: string,
  connected: (socket: Socket) => void,
) {
  // A socket left by an agent that stopped.
  await rm(path, { force: true })
  const server = createServer(connected)
  await new Promise<void>((done, fail) =>
    server.once('error', fail).listen(path, done),
  )
  return server
}

function listenOnPort(
  port: number,
  fetch: (request: Request) => Promise<Response>,
) {
  return new Promise<Server>((done, fail) => {
    const server = serve({ fetch, port, hostname: '0.0.0.0' }, () =>
      done(server as Server),
    ).once('error', fail)
  })
}
