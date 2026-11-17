#!/usr/bin/env node
import { startProxy } from './proxy.ts'

// The proxy as the Docker provider runs it, beside its computers.
const host = process.env.FAMILIAR_HOST_ADDRESS
if (!host) {
  console.error('Set FAMILIAR_HOST_ADDRESS to the host as host:port.')
  process.exit(1)
}
const proxy = startProxy({ host })
console.log(`Proxying; computers reach ${host}.`)
const stop = () => {
  proxy.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
