import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import { getAccessToken } from './api'
import type { MessageDto } from './types'

type Handler = (...args: any[]) => void

let connection: HubConnection | null = null
let starting: Promise<HubConnection> | null = null
/** A connection was up before: the next fresh start must tell open screens to catch up (rejoin rooms, refetch). */
let everConnected = false
let retryTimer = 0

/**
 * The automatic reconnect gives up after about a minute, and iOS drops the socket of an app in the background.
 * While the app is on screen, keep trying; coming back to the app also restarts it (AppShell).
 */
function scheduleRetry() {
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    if (connection && document.visibilityState === 'visible') void ensureHub().catch(() => undefined)
  }, 10_000)
}
const handlers = new Map<string, Set<Handler>>()
const stateListeners = new Set<(s: HubConnectionState) => void>()

function emitState() {
  const s = connection?.state ?? HubConnectionState.Disconnected
  stateListeners.forEach((l) => l(s))
}

function build() {
  const c = new HubConnectionBuilder()
    .withUrl('/hubs/chat', { accessTokenFactory: async () => (await getAccessToken()) ?? '' })
    .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 20000, 30000])
    .configureLogging(LogLevel.Warning)
    .build()
  c.serverTimeoutInMilliseconds = 60_000
  for (const event of ['message', 'messageUpdated', 'typing', 'roomActivity', 'roomUpdated', 'roomAdded', 'roomRemoved', 'notification', 'muted']) {
    c.on(event, (...args) => handlers.get(event)?.forEach((h) => h(...args)))
  }
  c.onreconnecting(emitState)
  c.onreconnected(() => { emitState(); handlers.get('reconnected')?.forEach((h) => h()) })
  c.onclose(() => { emitState(); if (connection === c) scheduleRetry() })
  return c
}

export async function ensureHub(): Promise<HubConnection> {
  if (connection?.state === HubConnectionState.Connected) return connection
  if (starting) return starting
  connection ??= build()
  starting = (async () => {
    try {
      const c = connection!
      if (c.state === HubConnectionState.Disconnected) {
        await c.start()
        // A fresh connection is in no room yet and missed whatever was sent while it was down.
        if (everConnected) handlers.get('reconnected')?.forEach((h) => h())
        everConnected = true
      }
      emitState()
      return c
    } catch (e) {
      scheduleRetry()
      throw e
    } finally {
      starting = null
    }
  })()
  return starting
}

export async function stopHub() {
  const c = connection
  connection = null
  everConnected = false
  window.clearTimeout(retryTimer)
  await c?.stop().catch(() => undefined)
  emitState()
}

export function onHub(event: string, handler: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(handler)
  return () => { handlers.get(event)?.delete(handler) }
}

export function onHubState(listener: (s: HubConnectionState) => void) {
  stateListeners.add(listener)
  return () => { stateListeners.delete(listener) }
}

export function hubState() {
  return connection?.state ?? HubConnectionState.Disconnected
}

export async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const c = await ensureHub()
  return c.invoke<T>(method, ...args)
}

export const chatHub = {
  joinRoom: (roomId: string, afterId: number) => invoke<MessageDto[]>('JoinRoom', roomId, afterId),
  leaveRoom: (roomId: string) => invoke<void>('LeaveRoom', roomId).catch(() => undefined),
  send: (req: { roomId: string; body: string; replyToId?: number | null; attachmentIds?: string[]; clientId: string }) =>
    invoke<MessageDto>('SendMessage', req),
  typing: (roomId: string) => invoke<void>('Typing', roomId).catch(() => undefined),
  markRead: (roomId: string, lastId: number) => invoke<void>('MarkRead', roomId, lastId).catch(() => undefined),
  react: (messageId: number, emoji: string) => invoke<MessageDto>('React', messageId, emoji),
  delete: (messageId: number) => invoke<MessageDto>('DeleteMessage', messageId),
  pin: (messageId: number, pinned: boolean) => invoke<MessageDto>('Pin', messageId, pinned),
  markAnswer: (messageId: number, isAnswer: boolean) => invoke<MessageDto>('MarkAnswer', messageId, isAnswer),
}

/** SignalR wraps server errors as "An unexpected error occurred invoking 'X' on the server. HubException: <message>". */
export function hubErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const idx = raw.indexOf('HubException:')
  return idx >= 0 ? raw.slice(idx + 'HubException:'.length).trim() : 'لم تُرسَل الرسالة. أعد المحاولة.'
}
