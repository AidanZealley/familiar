import type { Notification } from '@familiar-ai/core'
import type { PushHost, PushSubscriptionJson } from '@familiar-ai/core/http'
import webpush from 'web-push'
import { jsonFile } from '@familiar-ai/core/node'

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
  /** web-push's socket `timeout`, in milliseconds; shortened in tests. */
  timeout?: number
}

/**
 * How long a push service's connection may sit silent before web-push
 * abandons the delivery, so one stalled service can't hold up a scheduled
 * run. It is a socket inactivity timeout: a slow but moving response can
 * take longer, which push services' short answers never need.
 */
const PUSH_TIMEOUT_MS = 30_000

/** A subscription with who subscribed it: the `Author.id` the daemon authenticated. */
type Stored = PushSubscriptionJson & { subscriber: string }

/** Push services answer these for a subscription that no longer exists. */
const GONE = [404, 410]

/**
 * Web Push for Familiar's notifications: the routes' host, and `notify`,
 * which sends to every subscribed browser and forgets the ones that are gone.
 * Everyone in the conversation gets every notification; each subscriber can
 * change only their own subscriptions.
 */
export function openPush(options: PushOptions) {
  const send = options.send ?? webpush.sendNotification
  // Generated once and saved at once: every subscription is tied to this key.
  const keys = jsonFile(options.path?.('vapid.json'), () =>
    webpush.generateVAPIDKeys(),
  )
  keys.save()
  const vapid = keys.value
  const subscriptions = jsonFile<Stored[]>(
    options.path?.('push.json'),
    () => [],
  )

  /** Forgets `endpoint`: everyone's, or only `subscriber`'s when given. */
  const remove = (endpoint: string, subscriber?: string) => {
    subscriptions.value = subscriptions.value.filter(
      (other) =>
        other.endpoint !== endpoint ||
        (subscriber !== undefined && other.subscriber !== subscriber),
    )
  }

  // Knowing someone else's endpoint changes nothing of theirs.
  const host: PushHost = {
    publicKey: () => vapid.publicKey,
    subscribe: async (subscription, { id }) => {
      remove(subscription.endpoint, id)
      subscriptions.value.push({ ...subscription, subscriber: id })
      subscriptions.save()
    },
    unsubscribe: async ({ endpoint }, { id }) => {
      remove(endpoint, id)
      subscriptions.save()
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
      subscriptions.save()
    }
    // Core reports it: other browsers still got the notification.
    if (failures.length) {
      throw new AggregateError(failures, 'Some push notifications failed.')
    }
  }

  return { host, notify }
}
