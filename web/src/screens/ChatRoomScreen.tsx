import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowDown, Bell, CheckCheck, Copy, FileText, Flag, Loader2, Lock, Megaphone, MessageCircleQuestion,
  MoreVertical, Paperclip, Pin, Reply, SendHorizonal, ShieldCheck, Trash2, Users, X,
} from 'lucide-react'
import { ApiError, api, fetchBlobUrl } from '../lib/api'
import { chatHub, ensureHub, hubErrorMessage, onHub } from '../lib/hub'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { dayKey, fileSize, formatDay, formatTime, relativeDay } from '../lib/format'
import type { LiveCourseDetail, MemberDto, MessageDto, RoomDetail } from '../lib/types'
import { Avatar, CourseCover, ErrorState, RoleBadge, Sheet, Skeleton, TopBar, useAuthedImage, useToast } from '../components/ui'
import { MentionList, MicButton, RichBody, VoicePlayer, VoiceRecorder, mentionQuery } from '../components/chatExtras'

const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅']
const isStaffRole = (r: string) => r !== 'student'

type Pending = { clientId: string; body: string; replyTo: MessageDto | null; attachments: Uploaded[]; failed?: string }
type Uploaded = { id: string; name: string; contentType: string; size: number }

function newId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function merge(list: MessageDto[], incoming: MessageDto[]) {
  const map = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

export function ChatRoomScreen() {
  const { roomId = '' } = useParams()
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const me = user?.partnerId ?? 0
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()

  const room = useQuery({ queryKey: ['room', roomId], queryFn: () => api<RoomDetail>(`/api/chats/${roomId}`) })
  const [messages, setMessages] = useState<MessageDto[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [loaded, setLoaded] = useState(false)
  const [joinError, setJoinError] = useState<unknown>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [typing, setTyping] = useState<Record<number, { name: string; until: number }>>({})
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null)
  const [menuFor, setMenuFor] = useState<MessageDto | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = messages.length ? messages[messages.length - 1].id : 0
  const lastIdRef = useRef(0)
  lastIdRef.current = lastId

  const staff = room.data ? isStaffRole(room.data.myRole) : false
  const members = useQuery({ queryKey: ['members', roomId], queryFn: () => api<MemberDto[]>(`/api/chats/${roomId}/members`), enabled: !!room.data, staleTime: 5 * 60_000 })
  const memberNames = useMemo(() => (members.data ?? []).map((m) => m.name), [members.data])
  const myName = useMemo(() => members.data?.find((m) => m.partnerId === me)?.name ?? user?.name ?? '', [members.data, me, user?.name])
  const [flash, setFlash] = useState<number | null>(null)
  /** Scroll to the quoted message and highlight it for a moment. */
  const jumpTo = (id: number) => {
    const el = document.getElementById(`m-${id}`)
    if (!el) { toast({ kind: 'info', text: t('replyNotLoaded') }); return }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(id)
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600)
  }
  const canWrite = room.data?.status === 'open' && (staff || !room.data.announcementOnly)
    && !(room.data.mutedUntil && new Date(room.data.mutedUntil) > new Date())

  // ---------------------------------------------------------------- live connection
  const join = useCallback(async (after: number) => {
    try {
      const batch = await chatHub.joinRoom(roomId, after)
      setMessages((list) => merge(list, batch))
      if (after === 0) setHasMore(batch.length >= 50)
      setJoinError(null)
    } catch (e) {
      setJoinError(new ApiError(hubErrorMessage(e), 0))
    } finally {
      setLoaded(true)
    }
  }, [roomId])

  useEffect(() => {
    setMessages([]); setPending([]); setLoaded(false); setHasMore(true)
    void ensureHub().then(() => join(0)).catch((e) => { setJoinError(e); setLoaded(true) })
    const offs = [
      onHub('message', (m: MessageDto) => {
        if (m.roomId !== roomId) return
        setMessages((list) => merge(list, [m]))
        if (m.clientId) setPending((p) => p.filter((x) => x.clientId !== m.clientId))
        setTyping((tp) => { const n = { ...tp }; delete n[m.sender.partnerId]; return n })
      }),
      onHub('messageUpdated', (m: MessageDto) => {
        if (m.roomId !== roomId) return
        setMessages((list) => merge(list, [m]))
        if (m.isPinned !== undefined) void queryClient.invalidateQueries({ queryKey: ['room', roomId] })
      }),
      onHub('typing', (e: { roomId: string; partnerId: number; name: string }) => {
        if (e.roomId !== roomId || e.partnerId === me) return
        setTyping((tp) => ({ ...tp, [e.partnerId]: { name: e.name, until: Date.now() + 4000 } }))
      }),
      onHub('roomUpdated', (e: { roomId: string }) => { if (e.roomId === roomId) void room.refetch() }),
      onHub('muted', (e: { roomId: string }) => { if (e.roomId === roomId) void room.refetch() }),
      onHub('roomRemoved', (e: { roomId: string }) => { if (e.roomId === roomId) navigate('/chats', { replace: true }) }),
      onHub('reconnected', () => void join(lastIdRef.current)),
    ]
    const tick = window.setInterval(() => setTyping((tp) => {
      const now = Date.now()
      const next = Object.fromEntries(Object.entries(tp).filter(([, v]) => v.until > now))
      return Object.keys(next).length === Object.keys(tp).length ? tp : next
    }), 1500)
    return () => { offs.forEach((o) => o()); window.clearInterval(tick); void chatHub.leaveRoom(roomId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // ---------------------------------------------------------------- scrolling
  const scrollToBottom = (smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  useLayoutEffect(() => {
    if (loaded && atBottom) scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, lastId, pending.length])

  const loadOlder = async () => {
    if (loadingOlder || !hasMore || !messages.length) return
    const el = scroller.current!
    const before = el.scrollHeight
    setLoadingOlder(true)
    try {
      const older = await api<MessageDto[]>(`/api/chats/${roomId}/messages?before=${messages[0].id}&limit=50`)
      setHasMore(older.length >= 50)
      setMessages((list) => merge(list, older))
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before + el.scrollTop })
    } finally {
      setLoadingOlder(false)
    }
  }

  const onScroll = () => {
    const el = scroller.current!
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (bottom !== atBottom) setAtBottom(bottom)
    if (el.scrollTop < 120) void loadOlder()
  }

  // ---------------------------------------------------------------- read state
  useEffect(() => {
    if (!lastId || !atBottom || document.visibilityState !== 'visible') return
    const id = window.setTimeout(() => {
      void chatHub.markRead(roomId, lastId).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['badges'] })
        void queryClient.invalidateQueries({ queryKey: ['chats'] })
      })
    }, 500)
    return () => window.clearTimeout(id)
  }, [lastId, atBottom, roomId, queryClient])

  // ---------------------------------------------------------------- sending
  const send = async (body: string, attachments: Uploaded[], reply: MessageDto | null, clientId: string = newId()) => {
    setPending((p) => [...p.filter((x) => x.clientId !== clientId), { clientId, body, replyTo: reply, attachments }])
    setAtBottom(true)
    try {
      const m = await chatHub.send({ roomId, body, replyToId: reply?.id ?? null, attachmentIds: attachments.map((a) => a.id), clientId })
      setMessages((list) => merge(list, [m]))
      setPending((p) => p.filter((x) => x.clientId !== clientId))
    } catch (e) {
      setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed: hubErrorMessage(e) } : x)))
    }
  }

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMenuFor(null)
    try {
      await fn()
      if (ok) toast({ kind: 'ok', text: ok })
    } catch (e) {
      toast({ kind: 'error', text: e instanceof ApiError ? e.message : hubErrorMessage(e) })
    }
  }

  // ---------------------------------------------------------------- render helpers
  const typingNames = Object.values(typing).map((x) => x.name.split(' ')[0])
  const pinned = room.data?.pinned[0]
  const items = useMemo(() => messages, [messages])

  const subtitle = typingNames.length
    ? `${typingNames.join('، ')} ${t('typing')}`
    : room.data ? (room.data.kind === 'question' ? (room.data.askedBy && staff ? room.data.askedBy : t('privateQuestion')) : `${room.data.memberCount} ${t('member')}`) : ''

  return (
    <div className="flex h-dvh flex-col bg-bg md:[&_.back-btn]:hidden">
      <TopBar
        back="/chats"
        title={
          <button className="flex w-full min-w-0 max-w-full items-center gap-2.5 text-start" onClick={() => setInfoOpen(true)}>
            <CourseCover eventId={room.data?.eventId} title={room.data?.title ?? '…'} className="h-9 w-9 shrink-0" rounded="rounded-xl" />
            <span className="min-w-0 flex-1">
              <span className="bidi block truncate" dir="auto">{room.data?.kind === 'question' ? `${t('privateQuestion')} · ` : ''}{room.data?.title ?? t('loading')}</span>
              <span className={clsx('block truncate text-xs font-normal', typingNames.length ? 'text-accent' : 'text-muted')}>{subtitle}</span>
            </span>
          </button>
        }
        actions={<button className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" onClick={() => setInfoOpen(true)} aria-label={t('groupSettings')}><MoreVertical className="h-5 w-5" /></button>}
      />

      {pinned && (
        <button className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-start"
          onClick={() => document.getElementById(`m-${pinned.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <Pin className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-accent">{t('pinned')}</span>
            <span className="block truncate text-sm" dir="auto">{pinned.body || pinned.attachments[0]?.name}</span>
          </span>
        </button>
      )}

      {/* messages */}
      <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-sunken/60 to-bg px-3 py-3 md:px-8">
        {joinError ? <ErrorState error={joinError} onRetry={() => join(0)} /> : null}
        {!loaded && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className={clsx('h-14', i % 2 ? 'ms-auto w-2/3' : 'w-3/4')} />)}</div>}
        {loadingOlder && <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>}
        {loaded && !hasMore && messages.length > 0 && (
          <p className="mx-auto mb-4 w-fit rounded-full bg-surface px-3 py-1 text-center text-[11px] text-muted shadow-card">
            {room.data?.kind === 'question'
              ? (lang === 'ar' ? 'هذه المحادثة بينك وبين فريق الدورة فقط.' : 'Only you and the course team see this conversation.')
              : (lang === 'ar' ? 'بداية مجموعة الدورة. تظهر الرسائل لأعضاء الدورة فقط.' : 'Start of the course group. Only course members see these messages.')}
          </p>
        )}
        {loaded && messages.length === 0 && pending.length === 0 && !joinError && room.data?.kind === 'course' && (
          <GroupWelcome room={room.data} />
        )}
        {loaded && messages.length === 0 && pending.length === 0 && !joinError && room.data?.kind !== 'course' && (
          <div className="mx-auto mt-10 max-w-xs rounded-2xl bg-surface p-5 text-center shadow-card">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-accent" />
            <p className="text-sm">{room.data?.kind === 'question'
              ? (lang === 'ar' ? 'اكتب سؤالك هنا، وسيصل إلى المحاضر وفريق الدورة فقط.' : 'Write your question. Only the instructor and course team see it.')
              : (lang === 'ar' ? 'مجموعة الدورة. اسأل وشارك زملاءك، وسيجيب المحاضر هنا.' : 'Your course group. Ask questions; your instructor answers here.')}</p>
          </div>
        )}

        {items.map((m, i) => {
          const prev = items[i - 1]
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
          const grouped = !newDay && prev && prev.sender.partnerId === m.sender.partnerId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
          return (
            <div key={m.id}>
              {newDay && <p className="num mx-auto my-3 w-fit rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-muted shadow-card">{relativeDay(m.createdAt, lang)}</p>}
              <Bubble m={m} mine={m.sender.partnerId === me} grouped={!!grouped} onMenu={() => setMenuFor(m)}
                onReact={(emoji) => act(() => chatHub.react(m.id, emoji))} me={me}
                names={memberNames} myName={myName} flash={flash === m.id} onJump={jumpTo}
                onReply={canWrite && !m.deleted ? () => setReplyTo(m) : undefined} />
            </div>
          )
        })}

        {pending.map((p) => (
          <div key={p.clientId} className="mb-1 flex justify-end">
            <div className={clsx('max-w-[80%] rounded-2xl rounded-ee-md px-3 py-2 text-[15px] shadow-card', p.failed ? 'bg-live/10 text-ink' : 'bg-brand-500/85 text-white')}>
              {p.attachments.map((a) => <p key={a.id} className="text-sm opacity-90">{a.contentType.startsWith('audio/') ? `🎤 ${t('voiceNote')}` : `📎 ${a.name}`}</p>)}
              <p className="whitespace-pre-wrap break-words" dir="auto">{p.body}</p>
              {p.failed ? (
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <span className="text-live">{p.failed}</span>
                  <button className="font-bold text-accent" onClick={() => send(p.body, p.attachments, p.replyTo, p.clientId)}>{t('retry')}</button>
                  <button className="text-muted" onClick={() => setPending((x) => x.filter((y) => y.clientId !== p.clientId))}><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : <Loader2 className="ms-auto mt-0.5 h-3 w-3 animate-spin opacity-70" />}
            </div>
          </div>
        ))}
      </div>

      {!atBottom && (
        <button className="fixed bottom-24 end-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-surface shadow-lift md:end-8" onClick={() => { setAtBottom(true); scrollToBottom(true) }}>
          <ArrowDown className="h-5 w-5" />
        </button>
      )}

      {/* composer */}
      {room.data && (canWrite
        ? <Composer roomId={roomId} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} members={(members.data ?? []).filter((m) => m.partnerId !== me)}
            onSend={(body, att) => { void send(body, att, replyTo); setReplyTo(null) }} />
        : <div className="flex items-center justify-center gap-2 border-t border-line bg-surface px-4 py-4 pb-[calc(16px+var(--safe-bottom))] text-center text-sm text-muted">
            {room.data.status !== 'open' ? <><Lock className="h-4 w-4" />{t('readOnly')}</>
              : room.data.announcementOnly ? <><Megaphone className="h-4 w-4" />{t('announcementOnly')}</>
              : <><Lock className="h-4 w-4" />{lang === 'ar' ? 'الكتابة متوقفة مؤقتًا' : 'Writing is paused for you'}</>}
          </div>)}

      {/* message actions */}
      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)}>
        {menuFor && (
          <div className="pb-2">
            {!menuFor.deleted && (
              <div className="mb-3 flex justify-between rounded-2xl bg-sunken p-2">
                {REACTIONS.map((e) => (
                  <button key={e} className={clsx('grid h-11 w-11 place-items-center rounded-full text-2xl transition active:scale-90',
                    menuFor.reactions.some((r) => r.emoji === e && r.partnerIds.includes(me)) && 'bg-brand-100')}
                    onClick={() => act(() => chatHub.react(menuFor.id, e))}>{e}</button>
                ))}
              </div>
            )}
            <MenuItem icon={Reply} label={t('reply')} onClick={() => { setReplyTo(menuFor); setMenuFor(null) }} hidden={!canWrite || menuFor.deleted} />
            <MenuItem icon={Copy} label={t('copy')} hidden={!menuFor.body} onClick={() => act(() => navigator.clipboard.writeText(menuFor.body), '✓')} />
            {staff && !menuFor.deleted && <>
              <MenuItem icon={Pin} label={menuFor.isPinned ? t('unpin') : t('pin')} onClick={() => act(() => chatHub.pin(menuFor.id, !menuFor.isPinned))} />
              <MenuItem icon={CheckCheck} label={menuFor.isAnswer ? t('unmarkAnswer') : t('markAnswer')} onClick={() => act(() => chatHub.markAnswer(menuFor.id, !menuFor.isAnswer))} />
            </>}
            <MenuItem icon={Flag} label={t('report')} hidden={menuFor.sender.partnerId === me || menuFor.deleted}
              onClick={() => act(() => api(`/api/chats/messages/${menuFor.id}/report`, { method: 'POST', json: { reason: '' } }), t('reportSent'))} />
            <MenuItem icon={Trash2} label={t('delete')} danger hidden={menuFor.deleted || (!staff && menuFor.sender.partnerId !== me)}
              onClick={() => act(() => chatHub.delete(menuFor.id))} />
          </div>
        )}
      </Sheet>

      {room.data && <RoomInfo open={infoOpen} onClose={() => setInfoOpen(false)} room={room.data} staff={staff} onChanged={() => room.refetch()} />}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger, hidden }: { icon: typeof Reply; label: string; onClick: () => void; danger?: boolean; hidden?: boolean }) {
  if (hidden) return null
  return (
    <button className={clsx('flex h-12 w-full items-center gap-3 rounded-xl px-2 text-start font-bold hover:bg-sunken', danger && 'text-live')} onClick={onClick}>
      <Icon className="h-5 w-5" />{label}
    </button>
  )
}

// ------------------------------------------------------------------ bubble

function Bubble({ m, mine, grouped, onMenu, onReact, me, names, myName, flash, onJump, onReply }: {
  m: MessageDto; mine: boolean; grouped: boolean; onMenu: () => void; onReact: (e: string) => void; me: number
  names: string[]; myName: string; flash: boolean; onJump: (id: number) => void; onReply?: () => void
}) {
  const { t, lang } = useI18n()
  const pressTimer = useRef<number>()
  const staff = isStaffRole(m.sender.role)
  // Swipe sideways to reply (phones); a long press opens the menu.
  const touch = useRef<{ x: number; y: number; dx: number; locked: boolean } | null>(null)
  const [dx, setDx] = useState(0)
  const startPress = (e: React.TouchEvent) => {
    const p = e.touches[0]
    touch.current = { x: p.clientX, y: p.clientY, dx: 0, locked: false }
    pressTimer.current = window.setTimeout(onMenu, 420)
  }
  const movePress = (e: React.TouchEvent) => {
    const tc = touch.current
    if (!tc) return
    const p = e.touches[0]
    const mx = p.clientX - tc.x, my = p.clientY - tc.y
    if (Math.abs(mx) > 6 || Math.abs(my) > 6) window.clearTimeout(pressTimer.current)
    if (!onReply || tc.locked || Math.abs(my) > Math.abs(mx)) { if (Math.abs(my) > 10) tc.locked = true; return }
    tc.dx = Math.max(-72, Math.min(72, mx))
    setDx(tc.dx)
  }
  const endPress = () => {
    window.clearTimeout(pressTimer.current)
    if (onReply && Math.abs(touch.current?.dx ?? 0) >= 56) { onReply(); navigator.vibrate?.(12) }
    touch.current = null
    setDx(0)
  }

  return (
    <div id={`m-${m.id}`} className={clsx('group relative flex items-end gap-2 rounded-2xl transition-colors duration-500', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-0.5' : 'mt-3', flash && 'bg-brand-500/10')}>
      {dx !== 0 && (
        <span className="pointer-events-none absolute top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-surface text-accent shadow-card"
          style={{ [dx > 0 ? 'left' : 'right']: 4, opacity: Math.min(1, Math.abs(dx) / 56) }}>
          <Reply className="h-4 w-4" />
        </span>
      )}
      {!mine && <span className="w-8 shrink-0">{!grouped && <Avatar partnerId={m.sender.partnerId} name={m.sender.name} size={32} />}</span>}
      <div
        className={clsx(
          'relative max-w-[80%] select-text rounded-2xl px-3 pb-1.5 pt-2 text-[15px] shadow-card md:max-w-[70%]',
          mine ? 'rounded-ee-md bg-brand-500 text-white'
            : staff ? 'rounded-es-md border border-brand-200 bg-brand-50 text-ink'
            : 'rounded-es-md bg-surface text-ink',
          m.isAnswer && 'ring-2 ring-ok/60',
        )}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onContextMenu={(e) => { e.preventDefault(); onMenu() }}
        onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={movePress} onTouchCancel={endPress}
      >
        {!mine && !grouped && (
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className={clsx('text-[13px] font-bold', staff ? 'text-accent' : 'text-[#8A5A0B] dark:text-gold')}>{m.sender.name}</span>
            <RoleBadge role={m.sender.role} />
          </div>
        )}
        {m.isAnswer && <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-ok"><CheckCheck className="h-3.5 w-3.5" />{t('instructorAnswer')}</p>}
        {m.replyTo && (
          <button type="button" onClick={() => onJump(m.replyTo!.id)}
            className={clsx('mb-1.5 block w-full rounded-lg border-s-4 px-2 py-1 text-start text-[13px] transition-colors', mine ? 'border-white/60 bg-white/15 hover:bg-white/25' : 'border-brand-400 bg-sunken hover:bg-brand-50')}>
            <p className="font-bold">{m.replyTo.senderName}</p>
            <p className="line-clamp-2 opacity-80" dir="auto">{m.replyTo.snippet}</p>
          </button>
        )}
        {m.deleted ? (
          <p className="italic opacity-70">{t('messageDeleted')}</p>
        ) : (
          <>
            {m.attachments.map((a) => <AttachmentView key={a.id} a={a} mine={mine} />)}
            {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed" dir="auto"><RichBody text={m.body} names={names} myName={myName} mine={mine} /></p>}
          </>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {m.isPinned && <Pin className="h-3 w-3 opacity-70" />}
          <span className={clsx('num text-[10px]', mine ? 'opacity-75' : 'text-muted')}>{formatTime(m.createdAt, lang)}</span>
        </div>
        {m.reactions.length > 0 && (
          <div className="absolute -bottom-3 end-2 flex gap-0.5">
            {m.reactions.map((r) => (
              <button key={r.emoji} onClick={() => onReact(r.emoji)}
                className={clsx('flex h-6 items-center gap-0.5 rounded-full border px-1.5 text-xs shadow-card', r.partnerIds.includes(me) ? 'border-brand-300 bg-brand-50' : 'border-line bg-surface')}>
                <span>{r.emoji}</span>{r.partnerIds.length > 1 && <span className="num text-[10px] text-ink">{r.partnerIds.length}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={clsx('hidden shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100 md:flex', mine && '-order-1')}>
        {onReply && (
          <button onClick={onReply} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink" aria-label={t('reply')} title={t('reply')}>
            <Reply className="h-4 w-4" />
          </button>
        )}
        <button onClick={onMenu} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink" aria-label="actions">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
      {m.reactions.length > 0 && <span className="block h-3" />}
    </div>
  )
}

function AttachmentView({ a, mine }: { a: MessageDto['attachments'][number]; mine: boolean }) {
  const isImage = a.contentType.startsWith('image/')
  const isAudio = a.contentType.startsWith('audio/')
  const url = useAuthedImage(isImage ? `/api/chats/attachments/${a.id}` : null)
  const toast = useToast()
  if (isImage) {
    return url
      ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.name} className="mb-1 max-h-72 w-full rounded-xl object-cover" /></a>
      : <Skeleton className="mb-1 h-40 w-56" />
  }
  if (isAudio) return <VoicePlayer id={a.id} mine={mine} />
  return (
    <button className={clsx('mb-1 flex w-full min-w-[200px] items-center gap-2 rounded-xl p-2 text-start', mine ? 'bg-white/15' : 'bg-sunken')}
      onClick={async () => {
        try {
          const href = await fetchBlobUrl(`/api/chats/attachments/${a.id}?download=true`)
          const link = document.createElement('a')
          link.href = href; link.download = a.name; link.click()
        } catch (e) { toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }) }
      }}>
      <FileText className="h-8 w-8 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold" dir="auto">{a.name}</span>
        <span className="num text-[11px] opacity-75">{fileSize(a.size)}</span>
      </span>
    </button>
  )
}

// ------------------------------------------------------------------ composer

function Composer({ roomId, replyTo, onCancelReply, onSend, members }: {
  roomId: string; replyTo: MessageDto | null; onCancelReply: () => void; onSend: (body: string, attachments: Uploaded[]) => void; members: MemberDto[]
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Uploaded[]>([])
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6)
  }, [mention, members])

  useEffect(() => { if (replyTo) area.current?.focus() }, [replyTo])
  useEffect(() => { setActive(0) }, [mention?.query])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const submit = () => {
    const body = text.trim()
    if (!body && files.length === 0) return
    onSend(body, files)
    setText(''); setFiles([]); setMention(null)
    area.current?.focus()
  }

  const pick = (m: MemberDto) => {
    if (!mention) return
    const el = area.current
    const caret = el?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.start)}@${m.name} ${text.slice(caret)}`
    setText(next)
    setMention(null)
    const pos = mention.start + m.name.length + 2
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos) })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); submit() }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    setMention(mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length))
    if (Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); void chatHub.typing(roomId) }
  }

  const uploadOne = (f: File) => {
    const form = new FormData()
    form.append('file', f)
    return api<Uploaded>(`/api/chats/${roomId}/attachments`, { method: 'POST', body: form })
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(list).slice(0, 5)) {
        const a = await uploadOne(f)
        setFiles((x) => [...x, a])
      }
    } catch (e) {
      toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /** A finished voice note goes out on its own, as a message with one audio attachment. */
  const sendVoice = async (file: File) => {
    setRecording(false)
    setUploading(true)
    try {
      const a = await uploadOne(file)
      onSend('', [a])
    } catch (e) {
      toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setUploading(false)
    }
  }

  const empty = !text.trim() && files.length === 0

  return (
    <div className="relative border-t border-line bg-surface/95 px-2 pb-[calc(8px+var(--safe-bottom))] pt-2 backdrop-blur md:px-6 md:pb-4 md:pt-3">
      <MentionList items={suggestions} active={active} onPick={pick} />
      {replyTo && (
        <div className="mx-1 mb-2 flex items-center gap-2 rounded-xl border-s-4 border-brand-400 bg-sunken px-3 py-2 text-sm">
          <Reply className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><p className="font-bold">{replyTo.sender.name}</p><p className="truncate text-muted" dir="auto">{replyTo.body || replyTo.attachments[0]?.name}</p></div>
          <button onClick={onCancelReply} className="text-muted" aria-label={t('close')}><X className="h-4 w-4" /></button>
        </div>
      )}
      {(files.length > 0 || uploading) && (
        <div className="mx-1 mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="chip h-8 bg-brand-50 text-accent">
              <Paperclip className="h-3.5 w-3.5" /><span className="max-w-[160px] truncate">{f.name}</span>
              <button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {uploading && <span className="chip h-8 bg-sunken text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('uploading')}</span>}
        </div>
      )}
      {recording ? (
        <VoiceRecorder onCancel={() => setRecording(false)} onDone={(f) => void sendVoice(f)}
          onError={(msg) => { setRecording(false); toast({ kind: 'error', text: msg }) }} />
      ) : (
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" hidden multiple accept="image/*,.pdf,.zip,.rar,.dwg,.dxf,.docx,.xlsx,.pptx,audio/*" onChange={(e) => upload(e.target.files)} />
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken" onClick={() => fileInput.current?.click()} aria-label={t('attachFile')}>
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea ref={area} rows={1} value={text} onChange={onChange} onKeyDown={onKey} placeholder={t('typeMessage')} dir="auto" maxLength={4000}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-[22px] border border-line bg-bg px-4 py-2.5 text-[16px] leading-6 outline-none focus:border-brand-300" />
          {empty && canRecord && !uploading
            ? <MicButton onClick={() => setRecording(true)} label={t('recordVoice')} />
            : (
              <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-white transition active:scale-90 disabled:opacity-40"
                onClick={submit} disabled={empty || uploading} aria-label={t('send')}>
                <SendHorizonal className="h-5 w-5 rtl:rotate-180" />
              </button>
            )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ room info

function RoomInfo({ open, onClose, room, staff, onChanged }: { open: boolean; onClose: () => void; room: RoomDetail; staff: boolean; onChanged: () => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const members = useQuery({ queryKey: ['members', room.id], queryFn: () => api<MemberDto[]>(`/api/chats/${room.id}/members`), enabled: open })
  const [level, setLevel] = useState<string>('important')

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); onChanged(); if (ok) toast({ kind: 'ok', text: ok }) } catch (e) { toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={room.kind === 'question' ? t('privateQuestion') : room.title}>
      <div className="space-y-5 pb-3">
        {room.kind === 'course' && room.myRole === 'student' && room.status === 'open' && (
          <button className="btn-soft w-full" onClick={() => run(async () => {
            const { roomId } = await api<{ roomId: string }>('/api/chats/questions', { method: 'POST', json: { eventId: room.eventId } })
            onClose(); navigate(`/chats/${roomId}`)
          })}>
            <MessageCircleQuestion className="h-5 w-5" />{t('askPrivately')}
          </button>
        )}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted"><Bell className="h-4 w-4" />{t('groupNotifications')}</h3>
          <div className="grid gap-1">
            {(['all', 'important', 'none'] as const).map((l) => (
              <label key={l} className="flex h-11 items-center gap-3 rounded-xl px-2 hover:bg-sunken">
                <input type="radio" name="notify" checked={level === l} className="h-4 w-4 accent-[rgb(var(--brand-500))]"
                  onChange={() => { setLevel(l); void run(() => api(`/api/chats/${room.id}/notifications`, { method: 'PUT', json: { notify: l } })) }} />
                <span>{l === 'all' ? t('notifyAll') : l === 'important' ? t('notifyImportant') : t('notifyNone')}</span>
              </label>
            ))}
          </div>
        </section>

        {staff && room.kind === 'course' && (
          <section>
            <h3 className="mb-2 text-sm font-bold text-muted">{t('groupSettings')}</h3>
            <label className="flex h-12 items-center justify-between rounded-xl px-2 hover:bg-sunken">
              <span className="flex items-center gap-2"><Megaphone className="h-4 w-4" />{t('announcementMode')}</span>
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand-500))]" checked={room.announcementOnly}
                onChange={(e) => run(() => api(`/api/chats/${room.id}`, { method: 'PATCH', json: { announcementOnly: e.target.checked } }))} />
            </label>
            <label className="flex h-12 items-center justify-between rounded-xl px-2 hover:bg-sunken">
              <span>{t('slowMode')}</span>
              <select className="rounded-lg border border-line bg-surface px-2 py-1" value={room.slowModeSeconds}
                onChange={(e) => run(() => api(`/api/chats/${room.id}`, { method: 'PATCH', json: { slowModeSeconds: Number(e.target.value) } }))}>
                <option value={0}>{t('off')}</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>1m</option>
                <option value={300}>5m</option>
              </select>
            </label>
          </section>
        )}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted"><Users className="h-4 w-4" />{t('members')} <span className="num">({room.memberCount})</span></h3>
          {members.isLoading && <Skeleton className="h-32 w-full" />}
          <ul className="divide-y divide-line/60">
            {members.data?.map((m) => (
              <li key={m.partnerId} className="flex items-center gap-3 py-2.5">
                <Avatar partnerId={m.partnerId} name={m.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className="truncate font-bold">{m.name}</span><RoleBadge role={m.role} /></span>
                  {m.mutedUntil && new Date(m.mutedUntil) > new Date() && <span className="text-xs text-warn">{lang === 'ar' ? 'مكتوم' : 'Muted'}</span>}
                </span>
                {staff && m.role === 'student' && (
                  m.mutedUntil && new Date(m.mutedUntil) > new Date()
                    ? <button className="btn-ghost h-8 px-2 text-xs" onClick={() => run(() => api(`/api/chats/${room.id}/mute`, { method: 'POST', json: { partnerId: m.partnerId, minutes: 0 } }).then(() => members.refetch()))}>{t('unmute')}</button>
                    : <button className="btn-ghost h-8 px-2 text-xs text-muted" onClick={() => run(() => api(`/api/chats/${room.id}/mute`, { method: 'POST', json: { partnerId: m.partnerId, minutes: 60 } }).then(() => members.refetch()), t('muteHour'))}>{t('muteHour')}</button>
                )}
              </li>
            ))}
          </ul>
          {!staff && <p className="mt-2 text-xs text-muted">{lang === 'ar' ? 'الرسائل الخاصة بين المتدربين غير متاحة. للأسئلة الخاصة استخدم «اطرح سؤالًا خاصًا على المحاضر».' : 'Private messages between learners are off. Use "Ask the instructor" for private questions.'}</p>}
        </section>
      </div>
    </Sheet>
  )
}

/**
 * A course group nobody has written in yet: the person just joined, so show what this group is, when the course
 * starts, and how it works, instead of an empty screen.
 */
function GroupWelcome({ room }: { room: RoomDetail }) {
  const { lang } = useI18n()
  const navigate = useNavigate()
  const ar = lang === 'ar'
  const course = useQuery({
    queryKey: ['live-course', String(room.eventId)],
    queryFn: () => api<LiveCourseDetail>(`/api/live-courses/${room.eventId}`),
    staleTime: 60_000,
  })
  const card = course.data?.course
  const next = card?.nextSession ?? null
  const first = next?.number === 1
  const staff = isStaffRole(room.myRole)
  const rules = staff
    ? [
        { icon: Megaphone, text: ar ? 'ما تكتبه هنا يصل إلى كل متدربي الدورة، ويصلهم إشعار برسائل فريق الدورة.' : 'Everything you post reaches every learner, with a notification.' },
        { icon: MessageCircleQuestion, text: ar ? 'تصلك أسئلة المتدربين هنا وفي الأسئلة الخاصة.' : 'Learner questions arrive here and as private questions.' },
      ]
    : [
        { icon: Megaphone, text: ar ? 'إعلانات المحاضر وتغيير المواعيد تصل هنا، ومعها إشعار.' : 'Instructor announcements and schedule changes arrive here, with a notification.' },
        { icon: MessageCircleQuestion, text: ar ? 'اسأل هنا، وسيجيبك المحاضر أو فريق الدورة.' : 'Ask here; the instructor or the course team answers.' },
        { icon: Lock, text: ar ? 'الرسائل لأعضاء الدورة فقط، ولا توجد رسائل خاصة بين المتدربين.' : 'Only course members see messages; learners cannot message each other privately.' },
      ]

  return (
    <div className="mx-auto mt-4 max-w-sm overflow-hidden rounded-3xl bg-surface shadow-card">
      <CourseCover eventId={room.eventId} title={room.title} className="aspect-[16/9] w-full" rounded="rounded-none" />
      <div className="p-5">
        <p className="text-[13px] font-semibold text-accent">{ar ? 'انضممت إلى مجموعة الدورة' : 'You joined the course group'}</p>
        <h2 className="mt-1 font-display text-xl font-bold leading-snug" dir="auto">{room.title}</h2>
        {/* Each part isolated, so a Latin code or name does not reorder the Arabic around it */}
        <p className="num mt-1 text-sm text-muted">
          {[room.code, card?.instructor?.name, `${room.memberCount} ${ar ? 'عضوًا' : 'members'}`].filter(Boolean).map((part, i) => (
            <span key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></span>
          ))}
        </p>

        {course.isLoading && <Skeleton className="mt-4 h-[68px] w-full" />}
        {next?.start && (
          <div className="mt-4 rounded-2xl bg-sunken px-4 py-3">
            <p className="text-xs text-muted">{first ? (ar ? 'أول محاضرة' : 'First session') : (ar ? 'المحاضرة القادمة' : 'Next session')}</p>
            <p className="num mt-0.5 font-bold">{formatDay(next.start, lang)} · {formatTime(next.start, lang)}</p>
            <p className="mt-0.5 truncate text-sm text-muted" dir="auto">{next.title}</p>
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {rules.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm leading-6">
              <Icon className="mt-1 h-4 w-4 shrink-0 text-accent" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <button type="button" className="btn-soft mt-5 w-full" onClick={() => navigate(`/live/${room.eventId}`)}>
          {ar ? 'صفحة الدورة والمحاضرات' : 'Course page and sessions'}
        </button>
      </div>
    </div>
  )
}
