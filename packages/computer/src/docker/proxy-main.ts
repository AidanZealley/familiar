#!/usr/bin/env node
import { OWN_ADDRESSES, startProxy } from './proxy.ts'

// The proxy as `dockerHost` runs it, beside its computers, told the Docker
// machine's own addresses.
startProxy({ own: process.env[OWN_ADDRESSES]?.split(',') ?? [] })
process.on('SIGTERM', () => process.exit(0))
