import { PassThrough, Readable } from 'node:stream'
import { expect, test } from 'vitest'
import { guardedFetch, responseBody } from './fetch.ts'

test('response bodies preserve bytes and close at end of input', async () => {
  const response = new Response(
    responseBody(Readable.from([Buffer.from('hello '), Buffer.from('世界')])),
  )
  expect(await response.text()).toBe('hello 世界')
})

// Like web_fetch refusing a 403 page that has already arrived. Readable.toWeb
// threw an uncaught ERR_INVALID_STATE here once a microtask had passed.
test('rejecting a response before reading its body safely cancels prefetched data', async () => {
  const source = new PassThrough()
  const response = new Response(responseBody(source))
  source.write(Buffer.from('<p>Forbidden</p>'))
  await Promise.resolve()
  await response.body!.cancel()
  await new Promise((resolve) => setImmediate(resolve))
  expect(source.destroyed).toBe(true)
})

test('download errors are read failures rather than uncaught process errors', async () => {
  const source = new PassThrough()
  const response = new Response(responseBody(source))
  const reading = response.text()
  source.destroy(new Error('download disconnected'))
  await expect(reading).rejects.toThrow('download disconnected')
})

test.each([
  'http://127.0.0.1/',
  'http://10.0.0.1/',
  'http://100.100.1.1/', // Tailscale
  'http://[::ffff:127.0.0.1]/',
  'http://localhost/',
])('refuses %s', async (url) => {
  await expect(guardedFetch(url)).rejects.toThrow(/not allowed/)
})
