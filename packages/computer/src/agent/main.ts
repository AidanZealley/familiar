#!/usr/bin/env node
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startAgent } from './index.ts'
import { AGENT_PORT_ENV, AGENT_SOCKET, PROXY_PORT } from './socket.ts'

const usage = `Usage: familiar-computer [--socket <path>] [--data-dir <dir>] [--proxy-socket <path>]

Serves a Familiar's computer tools over MCP on a Unix socket, default
${AGENT_SOCKET}, or with ${AGENT_PORT_ENV} set, over Streamable HTTP on that
port instead. With --proxy-socket, passes connections to 127.0.0.1:${PROXY_PORT}
on to that proxy's Unix socket.`

const { values } = parseArgs({
  options: {
    socket: { type: 'string' },
    'data-dir': { type: 'string' },
    'proxy-socket': { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(usage)
  process.exit(0)
}

const dataDir = resolve(
  values['data-dir'] ?? resolve(homedir(), '.familiar-computer'),
)
const port = process.env[AGENT_PORT_ENV]
const listen = port
  ? { port: Number(port) }
  : { socket: values.socket ?? AGENT_SOCKET }
const agent = await startAgent({
  ...listen,
  dataDir,
  proxySocket: values['proxy-socket'],
})
console.log(
  `Listening on ${'port' in listen ? `port ${listen.port}` : listen.socket}.`,
)
const stop = () => void agent.stop().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
