import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * App updates. A new deploy downloads in the background (the service worker) and then waits. Right after launch it
 * takes over silently; later it never interrupts: the app shows a bar and one tap switches to the new version.
 * Without this the person had to refresh several times, because a refresh alone keeps the running version.
 */

const listeners = new Set<(ready: boolean) => void>()
let ready = false
let send: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined
let lastCheck = 0
let started = false

const RELOAD_KEY = 'engosoft.update-reload'
const LAUNCH_WINDOW_MS = 6000

function setReady(value: boolean) {
  ready = value
  listeners.forEach((l) => l(value))
}

/** Asks the server for a newer version, at most once a minute. */
export function checkForUpdate() {
  if (!registration || Date.now() - lastCheck < 60_000) return
  lastCheck = Date.now()
  void registration.update().catch(() => undefined)
}

function reloadedForUpdateRecently() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 30_000 } catch { return false }
}

export function startUpdates() {
  if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  started = true
  send = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Just launched and nothing to lose: switch now. (Not twice in a row, in case the switch did not take.)
      if (performance.now() < LAUNCH_WINDOW_MS && !reloadedForUpdateRecently()) void applyUpdate()
      else setReady(true)
    },
    onRegisteredSW(_url, reg) {
      registration = reg
      window.setInterval(checkForUpdate, 30 * 60_000)
    },
  })
  // Coming back to the app is when a new deploy is most likely to be waiting.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
}

let applying = false

/** Switches to the waiting version: it takes control and the page reloads once into it. */
export async function applyUpdate() {
  if (applying) return
  applying = true
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* ignore */ }
  // The reload normally comes from the new worker taking control; if that never happens, reload anyway.
  window.setTimeout(() => window.location.reload(), 4000)
  if (send) await send(true)
  else window.location.reload()
}

export function useUpdateReady() {
  const [value, setValue] = useState(ready)
  useEffect(() => {
    listeners.add(setValue)
    setValue(ready)
    return () => { listeners.delete(setValue) }
  }, [])
  return value
}
