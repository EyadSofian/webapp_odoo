import { Suspense, useMemo, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Lock, Megaphone, MessageCircleQuestion, MessagesSquare, Search } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { chatTime } from '../lib/format'
import type { RoomListItem } from '../lib/types'
import { CourseCover, EmptyState, ErrorState, Skeleton, TopBar } from '../components/ui'

/** Phones: the list, or one conversation. Tablets and desktops: both side by side. */
export function ChatsLayout() {
  const { roomId } = useParams()
  return (
    <div className="md:flex md:h-dvh">
      <div className={clsx('md:flex md:w-[380px] md:shrink-0 md:flex-col md:border-e md:border-line md:bg-surface', roomId && 'hidden md:flex')}>
        <ChatsScreen activeId={roomId} />
      </div>
      <div className={clsx('min-w-0 flex-1', !roomId && 'hidden md:block')}>
        <Suspense fallback={<div className="h-dvh bg-sunken/40" />}><Outlet /></Suspense>
      </div>
    </div>
  )
}

export function ChatsPlaceholder() {
  const { t, lang } = useI18n()
  return (
    <div className="grid h-dvh place-items-center bg-sunken/40 p-10">
      <div className="max-w-sm text-center">
        <img src="/art/empty-chat.webp" alt="" className="mb-6 aspect-[16/10] w-full rounded-3xl object-cover shadow-lift" />
        <h2 className="font-display text-xl font-bold">{t('chats')}</h2>
        <p className="mt-2 text-sm text-muted">{lang === 'ar' ? 'اختر مجموعة من القائمة. تظهر الرسائل لأعضاء الدورة فقط، ولا توجد رسائل خاصة بين المتدربين.' : 'Pick a group. Messages are visible to course members only; learners cannot message each other privately.'}</p>
      </div>
    </div>
  )
}

export function ChatsScreen({ activeId }: { activeId?: string }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['chats'], queryFn: () => api<RoomListItem[]>('/api/chats'), refetchInterval: 60_000 })
  const rooms = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? []).filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.code?.toLowerCase().includes(needle))
  }, [data, q])

  return (
    <div className="mx-auto max-w-3xl md:flex md:h-full md:w-full md:flex-col">
      <TopBar title={t('chats')} />
      <div className="px-4 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-5 w-5 text-muted" />
          <input className="field h-11 ps-10" placeholder={lang === 'ar' ? 'ابحث عن مجموعة' : 'Search groups'} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[72px] w-full" />)}</div>}
      {data && data.length === 0 && <EmptyState image="/art/empty-chat.webp" icon={<MessagesSquare className="h-7 w-7" />} title={t('chats')} body={t('chatsEmpty')} />}

      <ul className="mt-2 md:flex-1 md:overflow-y-auto">
        {rooms.map((r) => (
          <li key={r.id}>
            <Link to={`/chats/${r.id}`} className={clsx('flex items-center gap-3 px-4 py-3 transition hover:bg-sunken/60 active:bg-sunken', activeId === r.id && 'bg-brand-50 hover:bg-brand-50')}>
              <div className="relative">
                <CourseCover eventId={r.eventId} title={r.title} className="h-14 w-14" rounded="rounded-2xl" />
                {r.kind === 'question' && (
                  <span className="absolute -bottom-1 -end-1 grid h-6 w-6 place-items-center rounded-full bg-gold text-white ring-2 ring-bg"><MessageCircleQuestion className="h-3.5 w-3.5" /></span>
                )}
              </div>
              <div className="min-w-0 flex-1 border-b border-line/60 pb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-bold" dir="auto">{r.kind === 'question' ? `${t('privateQuestion')} · ${r.title}` : r.title}</p>
                  {r.lastMessage && <span className={clsx('num shrink-0 text-[11px]', r.unreadCount ? 'font-bold text-accent' : 'text-muted')}>{chatTime(r.lastMessage.at, lang)}</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  {r.status === 'readonly' && <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />}
                  {r.announcementOnly && <Megaphone className="h-3.5 w-3.5 shrink-0 text-muted" />}
                  <p className="min-w-0 flex-1 truncate text-sm text-muted" dir="auto">
                    {r.lastMessage
                      ? <><span className={clsx('font-bold', r.lastMessage.senderRole !== 'student' && 'text-accent')}>{r.lastMessage.senderName.split(' ')[0]}: </span>{r.lastMessage.text}</>
                      : <span className="num">{r.code ?? ''} · {r.memberCount} {t('member')}</span>}
                  </p>
                  {r.unreadCount > 0 && <span className="num min-w-[22px] rounded-full bg-brand-500 px-1.5 text-center text-[11px] font-bold leading-[22px] text-white">{r.unreadCount}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
