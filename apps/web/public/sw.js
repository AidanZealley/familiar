// Familiar's service worker: only notifications. Pages always come from the
// network, so there is nothing to cache or update.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
)

// The daemon sends a core Notification as JSON: { title, body, url? }.
self.addEventListener('push', (event) => {
  const { title = 'Familiar', body = '', url = '/' } = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      data: { url },
    }),
  )
})

// Focus an open window, showing `url`, or open one there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin)
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windows) => {
        const open = windows.find(
          (client) => new URL(client.url).origin === url.origin,
        )
        if (!open) {
          return self.clients.openWindow(url.href)
        }
        await open.focus()
        if (new URL(open.url).pathname !== url.pathname) {
          await open.navigate(url.href)
        }
      }),
  )
})
