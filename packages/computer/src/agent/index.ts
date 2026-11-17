import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { socketTransport } from '../transport.ts'
import { openBrowser } from './browser.ts'
import { computerServer } from './server.ts'

export type AgentOptions = {
  /** From pairing: the host's connect address, with the token as its #fragment. */
  link: string
  /** Where the agent keeps the browser's profile. */
  dataDir: string
  /** Where commands run and relative paths start. Default the user's home. */
  home?: string
  log?: (message: string) => void
}

const FIRST_RETRY_MS = 500
const MAX_RETRY_MS = 10_000

/**
 * Runs the computer agent: connects out to the Familiar host as its paired
 * computer and serves the computer's tools over MCP, reconnecting whenever
 * the connection drops, such as while the host restarts. The browser
 * outlives connections, so a host restart leaves its pages as they were.
 */
export function startAgent(options: AgentOptions) {
  const { url, token } = readLink(options.link)
  const log = options.log ?? (() => {})
  const browser = openBrowser(resolve(options.dataDir, 'browser'))
  const home = options.home ?? homedir()
  const stopping = new AbortController()
  let socket: WebSocket | undefined

  /** One connection, until it closes; whether it opened. */
  const connect = () =>
    new Promise<boolean>((done) => {
      let opened = false
      socket = new WebSocket(url, {
        headers: { authorization: `Bearer ${token}` },
      })
      const transport = socketTransport(socket)
      socket.onopen = () => {
        opened = true
        log(`Connected to ${url.origin}.`)
        computerServer(browser, home)
          .connect(transport)
          .catch((error) => log(`Couldn't serve: ${error}`))
      }
      socket.onmessage = (event) => transport.receive(String(event.data))
      socket.onclose = () => {
        transport.ended()
        done(opened)
      }
    })

  const running = (async () => {
    let wait = FIRST_RETRY_MS
    while (!stopping.signal.aborted) {
      if (await connect()) {
        wait = FIRST_RETRY_MS
        log('Disconnected; reconnecting.')
      } else {
        log(`Couldn't connect to ${url.origin}; trying again.`)
      }
      await sleep(wait, undefined, { signal: stopping.signal }).catch(() => {})
      wait = Math.min(wait * 2, MAX_RETRY_MS)
    }
  })()

  return {
    stop: async () => {
      stopping.abort()
      socket?.close()
      await running
      await browser.close()
    },
  }
}

/** The pairing link: where to connect, and the token, kept out of the URL sent. */
export function readLink(link: string) {
  const url = new URL(link)
  const token = decodeURIComponent(url.hash.slice(1))
  if (!token) {
    throw new Error('The pairing link has no token after its #.')
  }
  url.hash = ''
  return { url, token }
}
