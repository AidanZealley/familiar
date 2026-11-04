import { Hono } from 'hono'
import { validator } from 'hono/validator'

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionJson = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/**
 * Web Push, which the host owns: its keys and subscriptions live with the
 * host, and it delivers Familiar's `notify` to them. Core only routes to it.
 */
export type PushHost = {
  /** The VAPID public key browsers subscribe with, base64url. */
  publicKey(): string | Promise<string>
  subscribe(subscription: PushSubscriptionJson): Promise<void>
  unsubscribe(subscription: PushSubscriptionJson): Promise<void>
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
  return body as PushSubscriptionJson
})

const unavailable = { error: 'push is not available' } as const

/**
 * Push routes, mounted at `/push`, one route each. Each answers 404 when the
 * host has no push, so clients can tell notifications aren't available.
 */
export const pushOperations = (push: PushHost | undefined) => ({
  key: new Hono().get('/key', async (c) =>
    push
      ? c.json({ key: await push.publicKey() }, 200)
      : c.json(unavailable, 404),
  ),
  subscribe: new Hono().post('/subscriptions', subscription, async (c) => {
    if (!push) {
      return c.json(unavailable, 404)
    }
    await push.subscribe(c.req.valid('json'))
    return c.body(null, 204)
  }),
  unsubscribe: new Hono().delete('/subscriptions', subscription, async (c) => {
    if (!push) {
      return c.json(unavailable, 404)
    }
    await push.unsubscribe(c.req.valid('json'))
    return c.body(null, 204)
  }),
})

/** Every push route, mounted at `/push`. */
export const pushRoutes = (push: PushHost | undefined) => {
  const operations = pushOperations(push)
  return new Hono()
    .route('/', operations.key)
    .route('/', operations.subscribe)
    .route('/', operations.unsubscribe)
}
