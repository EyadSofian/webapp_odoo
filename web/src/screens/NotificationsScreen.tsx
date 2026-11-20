import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, CalendarClock, CheckCheck, FileText, Flag, PlayCircle, Video } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { chatTime } from '../lib/format'
import type { AppNotification } from '../lib/types'
import { EmptyState, ErrorState, Skeleton, TopBar } from '../components/ui'

function iconFor(kind: string) {
  if (kind === 'session_live') return { Icon: Video, tone: 'bg-live/10 text-live' }
  if (kind.startsWith('session')) return { Icon: CalendarClock, tone: 'bg-brand-50 text-accent' }
  if (kind === 'recording_ready') return { Icon: PlayCircle, tone: 'bg-ok/10 text-ok' }
  if (kind === 'document_added') return { Icon: FileText, tone: 'bg-gold/15 text-[#B7791F]' }
  if (kind === 'chat_report') return { Icon: Flag, tone: 'bg-warn/10 text-warn' }
  return { Icon: Bell, tone: 'bg-sunken text-muted' }
}

export function NotificationsScreen() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>('/api/notifications?limit=50') })
  const markAll = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST', json: {} }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['notifications'] }); void queryClient.invalidateQueries({ queryKey: ['badges'] }) },
  })
  const unread = data?.filter((n) => !n.read).length ?? 0

  // Opening the screen counts as seeing them, after a moment.
  useEffect(() => {
    if (!unread) return
    const id = window.setTimeout(() => markAll.mutate(), 2500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread])

  return (
    <div className="mx-auto max-w-3xl md:px-4">
      <TopBar title={t('notifications')} actions={unread > 0 && (
        <button className="btn-ghost h-9 px-3 text-sm text-accent" onClick={() => markAll.mutate()}><CheckCheck className="h-4 w-4" />{t('markAllRead')}</button>
      )} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
      {data && data.length === 0 && <EmptyState icon={<Bell className="h-7 w-7" />} title={t('noNotifications')} body={t('pushWhy')} />}
      <ul className="px-2 py-2">
        {data?.map((n) => {
          const { Icon, tone } = iconFor(n.kind)
          return (
            <li key={n.id}>
              <button className={clsx('flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-start transition hover:bg-sunken/60', !n.read && 'bg-brand-50/50')}
                onClick={() => n.url && navigate(n.url)}>
                <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', tone)}><Icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={clsx('line-clamp-2 text-[15px]', !n.read && 'font-bold')}>{n.title}</span>
                    <span className="num shrink-0 text-[11px] text-muted">{chatTime(n.createdAt, lang)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.body}</span>
                </span>
                {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
