import { PassThrough, Readable } from 'node:stream'
import { expect, test } from 'vitest'
import { defaultFetch, responseBody } from './fetch.ts'

test('bodies stream every byte, and a download error fails the read rather than the process', async () => {
  const response = new Response(
    responseBody(Readable.from([Buffer.from('hello '), Buffer.from('世界')])),
  )
  expect(await response.text()).toBe('hello 世界')

  const source = new PassThrough()
  const reading = new Response(responseBody(source)).text()
  source.destroy(new Error('download disconnected'))
  await expect(reading).rejects.toThrow('download disconnected')
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

test.each([
  'http://127.0.0.1/',
  'http://100.100.1.1/', // The tailnet
  'http://localhost/',
])('refuses %s', async (url) => {
  await expect(defaultFetch(url)).rejects.toThrow(/not allowed/)
})
