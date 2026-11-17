#!/usr/bin/env node
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startAgent } from './index.ts'
import { AGENT_SOCKET } from './socket.ts'

const usage = `Usage: familiar-computer [--socket <path>] [--data-dir <dir>]

Serves a Familiar's computer tools over MCP on a Unix socket, default
${AGENT_SOCKET}.`

const { values } = parseArgs({
  options: {
    socket: { type: 'string' },
    'data-dir': { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(usage)
  process.exit(0)
}

const agent = await startAgent({
  socket: values.socket ?? AGENT_SOCKET,
  dataDir: resolve(
    values['data-dir'] ?? resolve(homedir(), '.familiar-computer'),
  ),
})
console.log(`Listening on ${values.socket ?? AGENT_SOCKET}.`)
const stop = () => void agent.stop().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
