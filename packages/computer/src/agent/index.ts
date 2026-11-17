import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { openBrowser } from './browser.ts'
import { computerServer } from './server.ts'

export { AGENT_SOCKET } from './socket.ts'

export type AgentOptions = {
  /** The Unix socket to listen on. */
  socket: string
  /** Where the agent keeps the browser's profile. */
  dataDir: string
  /** Where commands run and relative paths start. Default the user's home. */
  home?: string
}

/**
 * Runs the computer agent: serves the computer's tools over MCP on a Unix
 * socket, one server per connection, as newline-delimited JSON-RPC (MCP's
 * stdio framing). It only listens: whatever hosts the computer reaches in,
 * such as `docker exec` running `socat`. The browser outlives connections,
 * so a new connection finds its pages as they were.
 */
export async function startAgent(options: AgentOptions) {
  const browser = openBrowser(resolve(options.dataDir, 'browser'))
  const home = options.home ?? homedir()
  // A socket left by an agent that stopped.
  await rm(options.socket, { force: true })
  const server = createServer((socket) => {
    // A connection that drops ends its server, which stops its calls.
    socket.on('error', () => socket.destroy())
    void computerServer(browser, home).connect(
      new StdioServerTransport(socket, socket),
    )
  })
  await new Promise<void>((done, fail) =>
    server.once('error', fail).listen(options.socket, done),
  )
  return {
    stop: async () => {
      server.close()
      await browser.close()
    },
  }
}
