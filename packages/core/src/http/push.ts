import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { Author } from '../conversation/message.ts'
import { can, type AccessEnv } from '../access.ts'

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionJson = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/**
 * Web Push, which the host owns: its keys and subscriptions live with the
 * host, and it delivers Familiar's `notify` to them. Core only routes to it,
 * with the authenticated subscriber. The host stores each subscription
 * with that subscriber and decides what they may change: an endpoint is
 * no proof of whose browser it is, so unsubscribing should only remove
 * the subscriber's own.
 */
export type PushHost = {
  /** The VAPID public key browsers subscribe with, base64url. */
  publicKey(): string | Promise<string>
  subscribe(
    subscription: PushSubscriptionJson,
    subscriber: Author,
  ): Promise<void>
  unsubscribe(
    subscription: PushSubscriptionJson,
    subscriber: Author,
  ): Promise<void>
}

const subscription = validator('json', (body, c) => {
  const keys = body?.keys as Partial<PushSubscriptionJson['keys']> | undefined
  if (
    typeof body?.endpoint !== 'string' ||
    !URL.canParse(body.endpoint) ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys.auth !== 'string'
  ) {
    return c.json({ error: 'a push subscription is required' }, 400)
  }
  // Only the subscription's own fields reach the host, never extras a
  // client added, such as a subscriber of its choosing.
  const valid: PushSubscriptionJson = {
    endpoint: body.endpoint,
    expirationTime:
      typeof body.expirationTime === 'number' ? body.expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  }
  return valid
})

const unavailable = { error: 'push is not available' } as const

/**
 * Push routes, mounted at `/push`. Each answers 404 when the host has no
 * push, so clients can tell notifications aren't available. The subscriber
 * is who the host authenticated the request as.
 */
export const pushRoutes = (push: PushHost | undefined) =>
  new Hono<AccessEnv>()
    .get('/key', can('push.key'), async (c) =>
      push
        ? c.json({ key: await push.publicKey() }, 200)
        : c.json(unavailable, 404),
    )
    .post('/subscriptions', can('push.subscribe'), subscription, async (c) => {
      if (!push) {
        return c.json(unavailable, 404)
      }
      await push.subscribe(c.req.valid('json'), c.get('author'))
      return c.body(null, 204)
    })
    .delete(
      '/subscriptions',
      can('push.unsubscribe'),
      subscription,
      async (c) => {
        if (!push) {
          return c.json(unavailable, 404)
        }
        await push.unsubscribe(c.req.valid('json'), c.get('author'))
        return c.body(null, 204)
      },
    )
