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
