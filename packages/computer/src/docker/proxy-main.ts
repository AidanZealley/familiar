#!/usr/bin/env node
import { startProxy } from './proxy.ts'

// The proxy as `dockerHost` runs it, beside its computers.
startProxy()
process.on('SIGTERM', () => process.exit(0))
