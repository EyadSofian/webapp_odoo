import type { TokenResponse } from './types'

const STORAGE_KEY = 'engosoft.session'

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
  }
}

interface StoredSession {
  accessToken: string
  expiresAt: string
  refreshToken: string
  user: TokenResponse['user']
}

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

let session: StoredSession | null = read()
const listeners = new Set<(s: StoredSession | null) => void>()

// Another tab refreshed or signed out: follow it, so this tab never reuses a rotated refresh token.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    session = read()
    listeners.forEach((l) => l(session))
  })
}

export const sessionStore = {
  get: () => session,
  set(next: StoredSession | null) {
    session = next
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* private mode: keep the session in memory only */
    }
    listeners.forEach((l) => l(next))
  },
  subscribe(listener: (s: StoredSession | null) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

let refreshing: Promise<string | null> | null = null

/** One refresh at a time; every caller waiting on an expired token shares it. */
async function refreshAccessToken(): Promise<string | null> {
  const current = sessionStore.get()
  if (!current) return null
  // Another tab may have rotated the tokens already.
  const latest = read()
  if (latest && latest.refreshToken !== current.refreshToken) {
    session = latest
    if (new Date(latest.expiresAt).getTime() - Date.now() > 60_000) return latest.accessToken
  }
  refreshing ??= (async () => {
    const used = sessionStore.get()
    if (!used) return null
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: used.refreshToken }),
      })
      if (!res.ok) {
        // Lost a race with another tab: take its fresh session instead of signing everyone out.
        const other = read()
        if (other && other.refreshToken !== used.refreshToken) { session = other; return other.accessToken }
        if (res.status === 401 || res.status === 403) sessionStore.set(null)
        return null
      }
      const data = (await res.json()) as TokenResponse
      sessionStore.set(data)
      return data.accessToken
    } catch {
      return null
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function getAccessToken(): Promise<string | null> {
  const s = sessionStore.get()
  if (!s) return null
  const expiresIn = new Date(s.expiresAt).getTime() - Date.now()
  if (expiresIn > 60_000) return s.accessToken
  return refreshAccessToken()
}

async function toError(res: Response): Promise<ApiError> {
  let message = 'حصلت مشكلة. جرّب تاني.'
  let code: string | undefined
  try {
    const body = await res.json()
    message = body.detail || body.title || message
    code = body.code || body.title
  } catch {
    /* not JSON */
  }
  if (res.status === 429) message = 'طلبات كتير ورا بعض. استنى ثواني وجرّب تاني.'
  if (res.status === 503) message = message || 'منصة إنجوسوفت مش بترد دلوقتي.'
  return new ApiError(message, res.status, code)
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const send = async (token: string | null) => {
    const headers = new Headers(rest.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (json !== undefined) headers.set('Content-Type', 'application/json')
    return fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body })
  }

  let res: Response
  try {
    res = await send(await getAccessToken())
    if (res.status === 401 && sessionStore.get()) {
      const token = await refreshAccessToken()
      if (token) res = await send(token)
    }
  } catch {
    throw new ApiError('مفيش اتصال بالإنترنت أو السيرفر مش متاح.', 0, 'offline')
  }

  if (!res.ok) throw await toError(res)
  if (res.status === 204 || res.status === 202) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? await res.json() : await res.blob()) as T
}

/** Images and files behind auth: fetch with the token and hand back an object URL. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const blob = await api<Blob>(path)
  return URL.createObjectURL(blob)
}

export async function login(email: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => {
    throw new ApiError('مفيش اتصال بالإنترنت أو السيرفر مش متاح.', 0, 'offline')
  })
  if (!res.ok) throw await toError(res)
  const data = (await res.json()) as TokenResponse
  sessionStore.set(data)
  return data
}

export async function devLoginAs(partnerId: number) {
  const res = await fetch('/api/dev/login-as', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partnerId }),
  })
  if (!res.ok) throw await toError(res)
  const data = (await res.json()) as TokenResponse
  sessionStore.set(data)
  return data
}

export async function logout() {
  const s = sessionStore.get()
  sessionStore.set(null)
  if (s) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    }).catch(() => undefined)
  }
}
