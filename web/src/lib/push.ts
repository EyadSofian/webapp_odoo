import { api } from './api'

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied'

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function pushState(): PushState {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  // iPhone and iPad only allow Web Push from an app added to the home screen (iOS 16.4+).
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return Notification.permission as PushState
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** Asks permission (must run from a tap) and registers this device. Returns the resulting state. */
export async function enablePush(): Promise<PushState> {
  const state = pushState()
  if (state === 'unsupported' || state === 'needs-install' || state === 'denied') return state
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission as PushState
  await syncSubscription()
  return 'granted'
}

/** Keeps the server's copy of this device's subscription current (keys can rotate). */
export async function syncSubscription() {
  if (pushState() !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('/api/push/public-key')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
  }
  const json = sub.toJSON()
  await api('/api/push/subscriptions', { method: 'POST', json: { endpoint: json.endpoint, keys: json.keys } })
}

export async function disablePush() {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => undefined)
    await sub.unsubscribe()
  }
}

export async function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try {
    if (count > 0) await nav.setAppBadge?.(count)
    else await nav.clearAppBadge?.()
  } catch { /* not supported */ }
}
