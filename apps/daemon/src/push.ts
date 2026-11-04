import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Notification } from '@familiar-ai/core'
import type { PushHost, PushSubscriptionJson } from '@familiar-ai/core/http'
import webpush from 'web-push'

export type PushOptions = {
  /**
   * Where to keep the VAPID keys and subscriptions (`vapid.json` and
   * `push.json`). Without it, both last as long as the process.
   */
  path?: (name: string) => string
  /** Who push services can contact about this sender: a mailto: or https: URL. */
  contact: string
  /** Sends one push; replaceable in tests. */
  send?: typeof webpush.sendNotification
  /** web-push's socket `timeout`, in milliseconds. Default `PUSH_TIMEOUT_MS`. */
  timeout?: number
}

/**
 * How long a push service's connection may sit silent before web-push
 * abandons the delivery, so one stalled service can't hold up a scheduled
 * run. It is a socket inactivity timeout: a slow but moving response can
 * take longer, which push services' short answers never need.
 */
export const PUSH_TIMEOUT_MS = 30_000

/**
 * A subscription with who subscribed it: the `Author.id` the daemon
 * authenticated. Saved before subscribers were recorded, it has none.
 */
type Stored = PushSubscriptionJson & { subscriber?: string }

/** Push services answer these for a subscription that no longer exists. */
const GONE = [404, 410]

/** Reads a JSON file, or creates it from `initial` if it's missing. */
function stored<T>(path: string | undefined, initial: () => T) {
  const save = (value: T) => {
    if (path) {
      writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), {
        mode: 0o600,
      })
      renameSync(`${path}.tmp`, path)
    }
  }
  if (path && existsSync(path)) {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as T, save }
  }
  const value = initial()
  save(value)
  return { value, save }
}

/**
 * Web Push for Familiar's notifications: the routes' host, and `notify`,
 * which sends to every subscribed browser and forgets the ones that are gone.
 * Everyone the daemon serves is its owner, so every subscription gets every
 * notification; each subscriber can still remove only their own.
 */
export function openPush(options: PushOptions) {
  const send = options.send ?? webpush.sendNotification
  // Generated once: every subscription is tied to this key.
  const vapid = stored(options.path?.('vapid.json'), () =>
    webpush.generateVAPIDKeys(),
  ).value
  const subscriptions = stored<Stored[]>(options.path?.('push.json'), () => [])

  /**
   * Whether `subscriber` may change this subscription: their own, or one
   * saved before subscribers were recorded, which anyone could change then.
   */
  const owns = (stored: Stored, subscriber: string) =>
    stored.subscriber === undefined || stored.subscriber === subscriber
  /** Forgets `endpoint`: everyone's, or only `subscriber`'s when given. */
  const remove = (endpoint: string, subscriber?: string) => {
    subscriptions.value = subscriptions.value.filter(
      (other) =>
        other.endpoint !== endpoint ||
        (subscriber !== undefined && !owns(other, subscriber)),
    )
  }

  // Knowing someone else's endpoint changes nothing of theirs.
  const host: PushHost = {
    publicKey: () => vapid.publicKey,
    subscribe: async (subscription, { id }) => {
      remove(subscription.endpoint, id)
      subscriptions.value.push({ ...subscription, subscriber: id })
      subscriptions.save(subscriptions.value)
    },
    unsubscribe: async ({ endpoint }, { id }) => {
      remove(endpoint, id)
      subscriptions.save(subscriptions.value)
    },
  }

  const notify = async (notification: Notification) => {
    const payload = JSON.stringify(notification)
    const gone: string[] = []
    const failures: unknown[] = []
    await Promise.all(
      subscriptions.value.map((subscription) =>
        send(subscription, payload, {
          vapidDetails: {
            subject: options.contact,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
          timeout: options.timeout ?? PUSH_TIMEOUT_MS,
        }).catch((error: unknown) => {
          if (
            error instanceof webpush.WebPushError &&
            GONE.includes(error.statusCode)
          ) {
            gone.push(subscription.endpoint)
          } else {
            failures.push(error)
          }
        }),
      ),
    )
    if (gone.length) {
      // The push service says the endpoint is gone, for whoever saved it.
      gone.forEach((endpoint) => remove(endpoint))
      subscriptions.save(subscriptions.value)
    }
    // Core reports it: other browsers still got the notification.
    if (failures.length) {
      throw new AggregateError(failures, 'Some push notifications failed.')
    }
  }

  return { host, notify }
}
