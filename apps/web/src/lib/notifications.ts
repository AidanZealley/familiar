import type { PushSubscriptionJson } from '@familiar-ai/client'
import { useCallback, useEffect, useState } from 'react'
import { familiar } from '@/lib/familiar'

/**
 * Notifications on this device. `unsupported` covers browsers without Web
 * Push (an iPhone outside the home-screen app), plain HTTP, and a server
 * without push.
 */
export type NotificationStatus =
  'checking' | 'unsupported' | 'off' | 'on' | 'blocked'

const supported = () =>
  window.isSecureContext &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

/** The VAPID key's base64url as the bytes `subscribe` wants. */
const keyBytes = (key: string) => {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

const sameKey = (subscription: PushSubscription, key: Uint8Array) => {
  const current = subscription.options.applicationServerKey
  return (
    !!current &&
    new Uint8Array(current).length === key.length &&
    new Uint8Array(current).every((byte, i) => byte === key[i])
  )
}

const asJson = (subscription: PushSubscription) =>
  subscription.toJSON() as PushSubscriptionJson

/**
 * The server's key and this device's subscription, if any. `current` says
 * whether it was made with that key; one made with an older key (a demo
 * restarted since) receives nothing. Undefined when the server has no push.
 */
async function devicePush() {
  const key = await familiar.getState().pushKey()
  if (!key) {
    return undefined
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  const bytes = keyBytes(key)
  return {
    key: bytes,
    registration,
    subscription,
    current: !!subscription && sameKey(subscription, bytes),
  }
}

/** Whether this device gets Familiar's notifications, and the means to change it. */
export function useNotifications() {
  const [status, setStatus] = useState<NotificationStatus>('checking')
  const [error, setError] = useState<string>()

  const check = useCallback(async () => {
    if (!supported()) {
      return 'unsupported'
    }
    if (Notification.permission === 'denied') {
      return 'blocked'
    }
    const push = await devicePush()
    if (!push) {
      return 'unsupported'
    }
    if (push.current && Notification.permission === 'granted') {
      // The server may have forgotten it (a fresh demo, a pruned endpoint).
      await familiar.getState().subscribePush(asJson(push.subscription!))
      return 'on'
    }
    return 'off'
  }, [])

  useEffect(() => {
    let current = true
    check()
      .then((next) => current && setStatus(next))
      .catch(() => current && setStatus('unsupported'))
    return () => {
      current = false
    }
  }, [check])

  const enable = async () => {
    setError(undefined)
    // First, before any await: iOS only asks from within the tap itself.
    const permission = Notification.requestPermission()
    try {
      if ((await permission) !== 'granted') {
        setStatus(Notification.permission === 'denied' ? 'blocked' : 'off')
        return
      }
      const push = await devicePush()
      if (!push) {
        setStatus('unsupported')
        return
      }
      if (push.subscription && !push.current) {
        await push.subscription.unsubscribe()
      }
      const subscription = push.current
        ? push.subscription!
        : await push.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: push.key,
          })
      await familiar.getState().subscribePush(asJson(subscription))
      setStatus('on')
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  const disable = async () => {
    setError(undefined)
    try {
      const subscription = (await devicePush())?.subscription
      if (subscription) {
        await familiar.getState().unsubscribePush(asJson(subscription))
        await subscription.unsubscribe()
      }
      setStatus('off')
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  return { status, error, enable, disable }
}
