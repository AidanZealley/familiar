import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Notification } from '@familiar/core'
import type { PushHost, PushSubscriptionJson } from '@familiar/core/http'
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
}

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
 */
export function openPush(options: PushOptions) {
  const send = options.send ?? webpush.sendNotification
  // Generated once: every subscription is tied to this key.
  const vapid = stored(options.path?.('vapid.json'), () =>
    webpush.generateVAPIDKeys(),
  ).value
  const subscriptions = stored<PushSubscriptionJson[]>(
    options.path?.('push.json'),
    () => [],
  )

  const remove = (endpoint: string) => {
    subscriptions.value = subscriptions.value.filter(
      (other) => other.endpoint !== endpoint,
    )
  }

  const host: PushHost = {
    publicKey: () => vapid.publicKey,
    subscribe: async (subscription) => {
      remove(subscription.endpoint)
      subscriptions.value.push(subscription)
      subscriptions.save(subscriptions.value)
    },
    unsubscribe: async ({ endpoint }) => {
      remove(endpoint)
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
      gone.forEach(remove)
      subscriptions.save(subscriptions.value)
    }
    // Core reports it: other browsers still got the notification.
    if (failures.length) {
      throw new AggregateError(failures, 'Some push notifications failed.')
    }
  }

  return { host, notify }
}
