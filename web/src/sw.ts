/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// App shell for every page; the API and the chat hub always go to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/hubs\//, /^\/health/] }))

// Course covers change rarely: keep them for offline browsing.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/media/courses/') || url.pathname.startsWith('/api/media/events/'),
  new CacheFirst({ cacheName: 'course-covers', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })] }),
)
registerRoute(({ url }) => url.pathname.startsWith('/brand/'), new StaleWhileRevalidate({ cacheName: 'brand' }))

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

interface PushPayload { title: string; body: string; url?: string; tag?: string; renotify?: boolean; requireInteraction?: boolean }

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'إنجوسوفت', body: '' }
  try { data = event.data?.json() ?? data } catch { data.body = event.data?.text() ?? '' }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      renotify: !!data.renotify && !!data.tag,
      requireInteraction: !!data.requireInteraction,
      dir: 'auto',
      lang: 'ar',
      data: { url: data.url ?? '/' },
    } as NotificationOptions)
    const nav = self.navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }
    await nav.setAppBadge?.().catch(() => undefined)
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await (client as WindowClient).focus()
        client.postMessage({ type: 'navigate', url })
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
