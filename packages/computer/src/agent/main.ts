#!/usr/bin/env node
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startAgent } from './index.ts'

const usage = `Usage: familiar-computer <pairing link> [--data-dir <dir>]

Makes this machine a Familiar's computer. The pairing link comes from the
Familiar host when it gives a Familiar a computer. It can be given as
FAMILIAR_COMPUTER_LINK instead, which keeps it out of the process list.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'data-dir': { type: 'string' }, help: { type: 'boolean' } },
})
const link = positionals[0] ?? process.env.FAMILIAR_COMPUTER_LINK
if (values.help || !link) {
  console.log(usage)
  process.exit(link ? 0 : 1)
}

const agent = startAgent({
  link,
  dataDir: resolve(
    values['data-dir'] ?? resolve(homedir(), '.familiar-computer'),
  ),
  log: (message) => console.log(message),
})
const stop = () => void agent.stop().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
