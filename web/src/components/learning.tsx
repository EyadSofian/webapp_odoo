import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { CalendarClock, ChevronLeft, FileText, PlayCircle, Video } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { countdown, formatTime, relativeDay } from '../lib/format'
import type { LiveCourseCard, RecordedCourseCard, SessionSummary } from '../lib/types'
import { CourseCover, LiveDot, ProgressBar, SessionPill, useToast } from './ui'

/** Re-render every 30s so countdowns and "live now" stay true. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Opens the Zoom link. The tab is opened during the tap so pop-up blockers allow it. */
export function useJoin() {
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  const join = async (sessionId: number) => {
    const win = window.open('', '_blank')
    setBusy(sessionId)
    try {
      const { url } = await api<{ url: string }>(`/api/sessions/${sessionId}/join`, { method: 'POST' })
      if (win) win.location.href = url
      else window.location.href = url
    } catch (e) {
      win?.close()
      toast({ kind: 'error', text: e instanceof ApiError ? e.message : 'حدثت مشكلة. أعد المحاولة.' })
    } finally {
      setBusy(null)
    }
  }
  return { join, busy }
}

export function NextSessionCard({ session, instructor, channelId }: { session: SessionSummary; instructor?: string | null; channelId?: number | null }) {
  const { t, lang } = useI18n()
  const now = useNow()
  const { join, busy } = useJoin()
  const live = session.status === 'live'
  const left = countdown(session.start, lang, now)
  return (
    <div className={clsx('card overflow-hidden text-ink animate-fade-up', live && 'ring-2 ring-live/40')}>
      <Link to={`/live/${session.eventId}`} className="flex gap-3 p-4">
        <CourseCover eventId={session.eventId} channelId={channelId} title={session.eventTitle} className="h-16 w-16 shrink-0" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {live ? <span className="chip bg-live/10 text-live"><LiveDot className="scale-75" />{t('liveNow')}</span>
              : <span className="chip bg-brand-50 text-accent"><CalendarClock className="h-3.5 w-3.5" />{relativeDay(session.start!, lang)} · {formatTime(session.start, lang)}</span>}
          </div>
          <p className="line-clamp-2 font-display text-[15px] font-bold leading-snug" dir="auto">{session.eventTitle}</p>
          <p className="truncate text-sm text-muted">{t('session')} <span className="num">{session.number}</span>{instructor ? <> · <bdi>{instructor}</bdi></> : null}</p>
        </div>
      </Link>
      <div className="flex items-center gap-3 border-t border-line/70 bg-sunken/50 px-4 py-3">
        {!live && left && (
          <div className="flex-1">
            <p className="text-[11px] text-muted">{t('startsIn')}</p>
            <p className="num font-bold text-accent">{left}</p>
          </div>
        )}
        {session.canJoin ? (
          <button className={clsx(live ? 'btn-live' : 'btn-primary', 'flex-1')} onClick={() => join(session.id)} disabled={busy === session.id}>
            <Video className="h-5 w-5" />{t('joinNow')}
          </button>
        ) : (
          <p className="flex-1 text-end text-xs text-muted">{t('joinOpensAt')}</p>
        )}
      </div>
    </div>
  )
}

/** Odoo names sessions "HVAC - Session 15"; inside a course that reads better as "المحاضرة 15". */
export function sessionLabel(s: SessionSummary, t: (k: 'session') => string) {
  const m = /(?:session|lecture|lec|محاضرة)\s*#?\s*(\d+)\s*$/i.exec(s.title)
  return m ? `${t('session')} ${m[1]}` : s.title
}

export function SessionRow({ s, compact }: { s: SessionSummary; compact?: boolean }) {
  const { t, lang } = useI18n()
  const { join, busy } = useJoin()
  return (
    <div className={clsx('flex items-center gap-3 py-3', s.status === 'cancelled' && 'opacity-60')}>
      <span className={clsx('num grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold',
        s.status === 'live' ? 'bg-live text-white' : s.status === 'ended' ? 'bg-sunken text-muted' : 'bg-brand-50 text-accent')}>
        {s.number}
      </span>
      <Link to={`/sessions/${s.id}`} className="min-w-0 flex-1">
        <p className="truncate font-bold" dir="auto">{compact ? s.eventTitle : sessionLabel(s, t)}</p>
        <p className="truncate text-xs text-muted">
          {compact
            ? <>{t('session')} <span className="num">{s.number}</span> · <span className="num">{formatTime(s.start, lang)}</span></>
            : s.start ? <>{relativeDay(s.start, lang)} · <span className="num">{formatTime(s.start, lang)}</span></> : null}
        </p>
      </Link>
      {s.canJoin ? (
        <button className={clsx(s.status === 'live' ? 'btn-live' : 'btn-primary', 'h-9 px-3 text-sm')} onClick={() => join(s.id)} disabled={busy === s.id}>
          <Video className="h-4 w-4" />{t('joinNow')}
        </button>
      ) : s.hasRecording ? (
        <Link to={`/sessions/${s.id}`} className="btn-soft h-9 shrink-0 px-3 text-sm"><PlayCircle className="h-4 w-4" />{t('recording')}</Link>
      ) : (
        <div className="flex items-center gap-2">
          {s.documentCount > 0 && <span className="chip bg-sunken text-muted"><FileText className="h-3.5 w-3.5" /><span className="num">{s.documentCount}</span></span>}
          {!(compact && s.status === 'upcoming') && <SessionPill status={s.status} />}
        </div>
      )}
    </div>
  )
}

export function modeLabel(mode: string, t: (k: 'online' | 'offlineRiyadh' | 'offlineCairo' | 'offlineHq') => string) {
  if (mode === 'online') return t('online')
  if (mode.endsWith('riyadh')) return t('offlineRiyadh')
  if (mode.endsWith('cairo')) return t('offlineCairo')
  return t('offlineHq')
}

export function LiveCourseItem({ c }: { c: LiveCourseCard }) {
  const { t, lang } = useI18n()
  const done = Math.min(c.sessionsTotal, c.nextSession ? c.nextSession.number - 1 : c.sessionsTotal)
  const pct = c.sessionsTotal ? (done / c.sessionsTotal) * 100 : 0
  const next = !c.expired && c.nextSession
    ? (c.nextSession.status === 'live' ? t('liveNow') : `${relativeDay(c.nextSession.start!, lang)} · ${formatTime(c.nextSession.start, lang)}`)
    : null
  return (
    <Link to={`/live/${c.eventId}`}
      className={clsx('card lift group flex h-full gap-3 p-3 active:scale-[0.99] md:flex-col md:gap-0 md:overflow-hidden md:p-0', c.expired && 'opacity-60')}>
      <CourseCover eventId={c.eventId} title={c.title} className="h-[76px] w-[76px] shrink-0 md:aspect-video md:h-auto md:w-full" rounded="rounded-xl md:rounded-none">
        {next && (
          <span className={clsx('absolute bottom-3 start-3 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold shadow-card md:inline-flex',
            c.nextSession?.status === 'live' ? 'bg-live text-white' : 'bg-surface/95 text-ink')}>
            <CalendarClock className="h-3.5 w-3.5" />{next}
          </span>
        )}
      </CourseCover>
      <div className="flex min-w-0 flex-1 flex-col md:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 font-display text-[15px] font-bold leading-snug md:min-h-[2.75em] md:text-[16px]" dir="auto">{c.title}</p>
          <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-muted ltr:rotate-180 md:hidden" />
        </div>
        <p className="truncate text-xs text-muted md:mt-1 md:text-[13px]">{c.instructor?.name ?? ''}{c.instructor ? ' · ' : ''}{modeLabel(c.mode, t)}</p>
        {c.expired ? (
          <span className="chip mt-2 w-fit bg-warn/10 text-warn">{t('expired')}</span>
        ) : (
          <div className="mt-2 flex items-center gap-2 md:mt-auto md:pt-4">
            <ProgressBar value={pct} className="flex-1" />
            <span className="num shrink-0 text-[11px] text-muted md:text-xs">{done}/{c.sessionsTotal}</span>
          </div>
        )}
        {next && <p className="mt-1.5 truncate text-[12px] font-bold text-accent md:hidden">{next}</p>}
      </div>
    </Link>
  )
}

export function RecordedCourseTile({ c, wide }: { c: RecordedCourseCard; wide?: boolean }) {
  const { t } = useI18n()
  return (
    <Link to={`/recorded/${c.channelId}`} className={clsx('card lift group block overflow-hidden active:scale-[0.99]', wide ? 'w-full' : 'w-[260px] shrink-0 snap-start md:w-auto', c.expired && 'opacity-60')}>
      <CourseCover channelId={c.channelId} title={c.title} className="aspect-video w-full" rounded="rounded-none" />
      <div className="p-3 md:p-4">
        <p className="line-clamp-2 min-h-[2.6em] font-display text-[14px] font-bold leading-snug md:text-[16px]" dir="auto">{c.title}</p>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={c.completion} className="flex-1" />
          <span className="num text-[11px] font-bold text-muted">{Math.round(c.completion)}%</span>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          <span className="num">{c.lessonsTotal}</span> {t('lessons')}
          {c.totalHours > 0 && <> · <span className="num">{c.totalHours}</span> {t('hours')}</>}
          {c.expired && <> · <span className="text-warn">{t('expired')}</span></>}
        </p>
      </div>
    </Link>
  )
}
