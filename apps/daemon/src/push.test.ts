import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import webpush from 'web-push'
import { expect, test } from 'vitest'
import { openPush } from './push.ts'

const subscription = (endpoint: string) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
})

test('push keeps its keys and subscriptions, and forgets gone browsers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'familiar-push-'))
  const path = (name: string) => join(dir, name)
  const sent: string[] = []
  const send: typeof webpush.sendNotification = async (to, payload) => {
    if (to.endpoint.endsWith('gone')) {
      throw new webpush.WebPushError('Gone', 410, {}, '', to.endpoint)
    }
    sent.push(`${to.endpoint} ${payload}`)
    return { statusCode: 201, body: '', headers: {} }
  }

  const push = openPush({ path, contact: 'mailto:test@example.com', send })
  await push.host.subscribe(subscription('https://push.example/phone'))
  await push.host.subscribe(subscription('https://push.example/gone'))
  await push.notify({ title: 'Familiar', body: 'Call Mum.', url: '/' })

  expect(sent).toEqual([
    'https://push.example/phone {"title":"Familiar","body":"Call Mum.","url":"/"}',
  ])
  expect(
    JSON.parse(readFileSync(path('push.json'), 'utf8')).map(
      ({ endpoint }: { endpoint: string }) => endpoint,
    ),
  ).toEqual(['https://push.example/phone'])
  // Windows protects the containing directory with ACLs, not POSIX mode bits.
  if (process.platform !== 'win32') {
    expect(statSync(path('vapid.json')).mode & 0o777).toBe(0o600)
    expect(statSync(path('push.json')).mode & 0o777).toBe(0o600)
  }

  // A restart keeps the key browsers subscribed with.
  const again = openPush({ path, contact: 'mailto:test@example.com', send })
  expect(await again.host.publicKey()).toBe(await push.host.publicKey())
})
