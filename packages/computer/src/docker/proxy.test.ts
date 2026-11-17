import { connect, createServer } from 'node:net'
import { expect, onTestFinished, test } from 'vitest'
import { isPublic, startProxy } from './proxy.ts'

// The proxy's one rule, which CI checks without Docker.
test('only public internet addresses are public', () => {
  const notPublic = [
    '127.0.0.1',
    '10.1.2.3',
    '172.17.0.1',
    '192.168.13.211',
    '100.97.253.21', // a tailnet
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    'fd7a:115c:a1e0::1',
    'fe80::1',
    '::ffff:192.168.1.1',
    'localhost',
  ]
  expect(notPublic.filter(isPublic)).toEqual([])
  expect(['93.184.215.14', '2606:4700::1111'].every(isPublic)).toBe(true)
})

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

/** Sends `request` to `port`: the reply, once the proxy closes the connection. */
const send = (port: number, request: string) =>
  new Promise<string>((resolve) => {
    let reply = ''
    const socket = connect(port, '127.0.0.1', () => socket.write(request))
    socket.on('data', (data) => (reply += data))
    socket.on('close', () => resolve(reply))
    socket.on('error', () => {})
  })

// One proxy serves every computer, so no request may bring it down.
test('the proxy refuses requests it can’t use and keeps serving', async () => {
  const proxyPort = await freePort()
  const proxy = startProxy(proxyPort)
  onTestFinished(() => void proxy.close())
  const close = 'Host: x\r\nConnection: close\r\n\r\n'
  expect(await send(proxyPort, `GET http://[ HTTP/1.1\r\n${close}`)).toMatch(
    /^HTTP\/1.1 400/,
  )
  expect(
    await send(proxyPort, `CONNECT example.com:0 HTTP/1.1\r\n${close}`),
  ).toMatch(/^HTTP\/1.1 403/)
  expect(
    await send(proxyPort, `GET http://example.com:0/ HTTP/1.1\r\n${close}`),
  ).toMatch(/^HTTP\/1.1 403/)
  expect(
    await send(proxyPort, `GET http://10.0.0.1/ HTTP/1.1\r\n${close}`),
  ).toMatch(/^HTTP\/1.1 403/)
})
