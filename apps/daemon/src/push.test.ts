import { createECDH, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import webpush from 'web-push'
import { expect, onTestFinished, test } from 'vitest'
import { openPush } from './push.ts'

const owner = { id: 'owner', name: 'Aidan' }
const contact = 'mailto:test@example.com'

const temporaryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'familiar-push-'))
  return (name: string) => join(dir, name)
}

const endpoints = (path: (name: string) => string) =>
  JSON.parse(readFileSync(path('push.json'), 'utf8')).map(
    ({ endpoint, subscriber }: { endpoint: string; subscriber?: string }) =>
      `${subscriber} ${endpoint}`,
  )

/** Records each push it's asked to send, and succeeds. */
const recorder = () => {
  const sent: { endpoint: string; options?: webpush.RequestOptions }[] = []
  const send: typeof webpush.sendNotification = async (to, _, options) => {
    sent.push({ endpoint: to.endpoint, options })
    return { statusCode: 201, body: '', headers: {} }
  }
  return { sent, send }
}

const subscription = (endpoint: string) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
})

test('push keeps its keys and subscriptions, and forgets gone browsers', async () => {
  const path = temporaryPath()
  const sent: string[] = []
  const send: typeof webpush.sendNotification = async (to, payload) => {
    if (to.endpoint.endsWith('gone')) {
      throw new webpush.WebPushError('Gone', 410, {}, '', to.endpoint)
    }
    sent.push(`${to.endpoint} ${payload}`)
    return { statusCode: 201, body: '', headers: {} }
  }

  const push = openPush({ path, contact, send })
  await push.host.subscribe(subscription('https://push.example/phone'), owner)
  await push.host.subscribe(subscription('https://push.example/gone'), owner)
  await push.notify({ title: 'Familiar', body: 'Call Mum.', url: '/' })

  expect(sent).toEqual([
    'https://push.example/phone {"title":"Familiar","body":"Call Mum.","url":"/"}',
  ])
  expect(endpoints(path)).toEqual(['owner https://push.example/phone'])
  if (process.platform !== 'win32') {
    expect(statSync(path('vapid.json')).mode & 0o777).toBe(0o600)
    expect(statSync(path('push.json')).mode & 0o777).toBe(0o600)
  }

  // A restart keeps the key browsers subscribed with.
  const again = openPush({ path, contact, send })
  expect(await again.host.publicKey()).toBe(await push.host.publicKey())
})

test("each subscriber changes only their own subscriptions, and everyone's get notified", async () => {
  const path = temporaryPath()
  const alice = { id: 'alice', name: 'Alice' }
  const bob = { id: 'bob', name: 'Bob' }
  const phone = 'https://push.example/alice-phone'
  const laptop = 'https://push.example/bob-laptop'
  const { sent, send } = recorder()
  const push = openPush({ path, contact, send })
  await push.host.subscribe(subscription(phone), alice)
  await push.host.subscribe(subscription(laptop), bob)

  // Knowing Alice's endpoint lets Bob remove or replace nothing of hers.
  await push.host.unsubscribe(subscription(phone), bob)
  await push.host.subscribe(
    { ...subscription(phone), keys: { p256dh: 'bob', auth: 'bob' } },
    bob,
  )
  await push.host.unsubscribe(subscription(phone), bob)
  expect(endpoints(path)).toEqual([`alice ${phone}`, `bob ${laptop}`])

  await push.notify({ title: 'Familiar', body: 'Bins.' })
  expect(sent.map(({ endpoint }) => endpoint)).toEqual([phone, laptop])

  // Her own, she can; it lasts across a restart.
  await push.host.unsubscribe(subscription(phone), alice)
  expect(endpoints(path)).toEqual([`bob ${laptop}`])
  const again = openPush({ path, contact, send })
  await again.host.unsubscribe(subscription(laptop), alice)
  expect(endpoints(path)).toEqual([`bob ${laptop}`])
})

/** A push service that accepts connections and never says anything. */
async function silentServer() {
  const sockets: Socket[] = []
  const server = createServer((socket) => sockets.push(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => {
    sockets.forEach((socket) => socket.destroy())
    server.close()
  })
  const address = server.address()
  return `https://127.0.0.1:${typeof address === 'object' && address?.port}/push`
}

/** A subscription a browser could have made, so web-push can encrypt to it. */
const realSubscription = (endpoint: string) => {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  }
}

test('a stalled push service times out and is reported, while other browsers get theirs', async () => {
  const stalled = await silentServer()
  const phone = 'https://push.example/phone'
  const { sent, send: record } = recorder()
  // The real web-push, against the silent service; recorded for the phone.
  const send: typeof webpush.sendNotification = (to, payload, options) =>
    to.endpoint === phone
      ? record(to, payload, options)
      : webpush.sendNotification(to, payload, options)
  const push = openPush({ contact, send, timeout: 100 })
  await push.host.subscribe(realSubscription(stalled), owner)
  await push.host.subscribe(realSubscription(phone), owner)

  const failure = await push.notify({ title: 'Familiar', body: 'Hi.' }).then(
    () => undefined,
    (error: unknown) => error,
  )

  expect(sent.map(({ endpoint }) => endpoint)).toEqual([phone])
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).errors).toEqual([
    expect.objectContaining({ message: 'Socket timeout' }),
  ])
  // A failure that isn't "gone" keeps the subscription for next time.
  await push.notify({ title: 'Familiar', body: 'Again.' }).catch(() => {})
  expect(sent).toHaveLength(2)
})
