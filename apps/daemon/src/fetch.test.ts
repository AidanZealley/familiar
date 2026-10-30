import { PassThrough, Readable } from 'node:stream'
import { expect, test } from 'vitest'
import { guardedFetch, responseBody } from './fetch.ts'

test('response bodies preserve bytes and close at end of input', async () => {
  const response = new Response(
    responseBody(Readable.from([Buffer.from('hello '), Buffer.from('世界')])),
  )
  expect(await response.text()).toBe('hello 世界')
})

test('cancelling while a pull is pending destroys the download without enqueueing after close', async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const source = new PassThrough()
    const reader = responseBody(source).getReader()
    const pending = reader.read()
    await Promise.resolve()
    const cancelled = reader.cancel()
    // Exercise a queued chunk racing cancellation, like a rejected binary page.
    source.write(Buffer.from('late bytes'), () => {})
    await cancelled
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(source.destroyed).toBe(true)
  }
})

test('rejecting a response before reading its body safely cancels prefetched data', async () => {
  const source = new PassThrough()
  const response = new Response(responseBody(source))
  source.write(Buffer.alloc(65536))
  await response.body!.cancel()
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
