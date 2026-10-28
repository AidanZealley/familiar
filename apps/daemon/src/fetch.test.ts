import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from 'vitest'
import { guardedFetch } from './fetch.ts'

test.each([
  'http://127.0.0.1/',
  'http://10.0.0.1/',
  'http://100.100.1.1/', // Tailscale
  'http://[::ffff:127.0.0.1]/',
  'http://localhost/',
])('refuses %s', async (url) => {
  await expect(guardedFetch(url)).rejects.toThrow(/not allowed/)
})

test('refuses a server that is really listening on this machine', async () => {
  const server = createServer((_request, response) => response.end('private'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      /not allowed/,
    )
  } finally {
    server.close()
  }
})
