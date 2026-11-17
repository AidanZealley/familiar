#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { OWN_ADDRESSES, PROXY_SOCKET, startProxy } from './proxy.ts'

// The proxy as `dockerHost` runs it, beside its computers, told the Docker
// machine's own addresses. A socket left by a proxy that stopped goes first.
rmSync(PROXY_SOCKET, { force: true })
startProxy({
  listen: PROXY_SOCKET,
  own: process.env[OWN_ADDRESSES]?.split(',') ?? [],
})
process.on('SIGTERM', () => process.exit(0))
