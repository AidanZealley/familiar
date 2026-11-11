import type { PushSubscriptionJson } from '@familiar-ai/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { workspace } from '@/lib/familiar'

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

const asJson = (subscription: PushSubscription) =>
  subscription.toJSON() as PushSubscriptionJson

/**
 * The server's key and this device's subscription, if any. `current` says
 * whether it was made with that key; one made with an older key (a demo
 * restarted since) receives nothing. Undefined when the server has no push.
 */
async function devicePush() {
  const key = await workspace.push.key()
  if (!key) {
    return undefined
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  const used = subscription?.options.applicationServerKey
  return {
    key,
    registration,
    subscription,
    current:
      !!used &&
      new Uint8Array(used).toBase64({
        alphabet: 'base64url',
        omitPadding: true,
      }) === key,
  }
}

async function check(): Promise<NotificationStatus> {
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
    await workspace.push.subscribe(asJson(push.subscription!))
    return 'on'
  }
  return 'off'
}

async function subscribe(permission: Promise<NotificationPermission>) {
  if ((await permission) !== 'granted') {
    return
  }
  const push = await devicePush()
  if (!push) {
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
  await workspace.push.subscribe(asJson(subscription))
}

async function unsubscribe() {
  const subscription = (await devicePush())?.subscription
  if (subscription) {
    await workspace.push.unsubscribe(asJson(subscription))
    await subscription.unsubscribe()
  }
}

/**
 * Whether this device gets Familiar's notifications, and the means to change
 * it. The status is checked again after each change, and whenever the page
 * regains focus, such as after allowing notifications in site settings.
 */
export function useNotifications() {
  const status = useQuery({ queryKey: ['notifications'], queryFn: check })
  const change = useMutation({
    mutationKey: ['notifications'],
    mutationFn: (permission?: Promise<NotificationPermission>) =>
      permission ? subscribe(permission) : unsubscribe(),
  })

  return {
    status: status.data ?? (status.isPending ? 'checking' : 'unsupported'),
    busy: change.isPending,
    error: change.error?.message,
    // Asked within the tap itself, before anything else: iOS only asks then.
    enable: () => change.mutate(Notification.requestPermission()),
    disable: () => change.mutate(undefined),
  }
}
