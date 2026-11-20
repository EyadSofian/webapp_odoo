import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bot, CalendarDays, ClipboardCheck, ClipboardList, Hash, Loader2, Lock, MessageCircleQuestion, MessagesSquare, PenLine, Sparkles, UserRound } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate, weekday } from '../lib/format'
import { Reveal, Stagger, StaggerItem, motion } from '../lib/motion'
import type { AssessmentCard, AssessmentDetail, LiveCourseDetail, RoomListItem, SessionSummary } from '../lib/types'
import { CourseCover, ErrorState, Segmented, Sheet, Skeleton, TopBar, useToast } from '../components/ui'
import { NextSessionCard, SessionRow, modeLabel, sessionLabel } from '../components/learning'

export function LiveCourseScreen() {
  const { eventId } = useParams()
  const [params] = useSearchParams()
  const highlight = Number(params.get('session')) || null
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['live-course', eventId],
    queryFn: () => api<LiveCourseDetail>(`/api/live-courses/${eventId}`),
    refetchInterval: 60_000,
  })
  const rooms = useQuery({ queryKey: ['chats'], queryFn: () => api<RoomListItem[]>('/api/chats'), staleTime: 30_000 })
  const room = rooms.data?.find((r) => r.kind === 'course' && r.eventId === Number(eventId))

  const ask = useMutation({
    mutationFn: () => api<{ roomId: string }>('/api/chats/questions', { method: 'POST', json: { eventId: Number(eventId) } }),
    onSuccess: ({ roomId }) => navigate(`/chats/${roomId}`),
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  const [showPast, setShowPast] = useState(false)
  const upcoming = useMemo(() => data?.sessions.filter((s) => s.status === 'upcoming' || s.status === 'live') ?? [], [data])
  const past = useMemo(() => (data?.sessions.filter((s) => s.status === 'ended' || s.status === 'cancelled') ?? []).slice().reverse(), [data])

  useEffect(() => {
    if (!highlight || !data) return
    if (past.some((s) => s.id === highlight)) setShowPast(true)
    window.setTimeout(() => document.getElementById(`session-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
  }, [highlight, data, past])

  const c = data?.course
  const done = past.filter((s) => s.status === 'ended').length
  const staff = c?.role === 'instructor'

  return (
    <div className="mx-auto max-w-6xl">
      <TopBar back title={c?.title} subtitle={c?.code ?? undefined} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4 md:p-8"><Skeleton className="h-56 w-full" /><Skeleton className="h-64 w-full" /></div>}

      {c && data && (
        <>
          <div className="relative md:mx-8 md:mt-2 md:overflow-hidden md:rounded-[28px]">
            <CourseCover eventId={c.eventId} title={c.title} className="aspect-[16/8] w-full md:aspect-[16/5]" rounded="rounded-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgb(6_32_58/0.92)] via-[rgb(6_32_58/0.35)] to-transparent" />
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="absolute inset-x-0 bottom-0 p-4 text-white md:p-8">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {c.code && <span className="chip bg-white/15 text-white backdrop-blur"><Hash className="h-3 w-3" /><span className="num">{c.code}</span></span>}
                <span className="chip bg-white/15 text-white backdrop-blur">{modeLabel(c.mode, t)}</span>
                {c.expired && <span className="chip bg-warn text-white"><Lock className="h-3 w-3" />{t('expired')}</span>}
              </div>
              <h2 className="font-display text-xl font-bold leading-snug md:text-4xl" dir="auto">{c.title}</h2>
              {c.instructor && <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/85 md:text-base"><UserRound className="h-4 w-4" /><bdi>{c.instructor.name}</bdi></p>}
            </motion.div>
          </div>

          <div className="grid gap-6 px-4 py-5 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              <Reveal>
                <section>
                  <h3 className="section-title mb-2">{t('sessions')}</h3>
                  <div className="card divide-y divide-line/70 px-4 md:px-5">
                    {upcoming.map((s) => (
                      <div key={s.id} id={`session-${s.id}`} className={clsx(highlight === s.id && '-mx-4 bg-brand-50/60 px-4 md:-mx-5 md:px-5')}><SessionRow s={s} /></div>
                    ))}
                    {past.length > 0 && (
                      <button className="w-full py-3 text-sm font-bold text-accent" onClick={() => setShowPast((v) => !v)}>
                        {showPast ? '▲' : '▼'} {lang === 'ar' ? `المحاضرات اللي فاتت (${past.length})` : `Past sessions (${past.length})`}
                      </button>
                    )}
                    {showPast && past.map((s) => (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} key={s.id} id={`session-${s.id}`} className={clsx(highlight === s.id && '-mx-4 bg-brand-50/60 px-4 md:-mx-5 md:px-5')}><SessionRow s={s} /></motion.div>
                    ))}
                  </div>
                </section>
              </Reveal>

              {!c.expired && <AssessmentsSection eventId={c.eventId} staff={staff} ended={past.filter((s) => s.status === 'ended')} />}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="card p-3"><p className="num text-lg font-bold">{done}<span className="text-sm text-muted">/{c.sessionsTotal}</span></p><p className="text-[11px] text-muted">{t('sessionsDone')}</p></div>
                <div className="card p-3"><p className="num text-lg font-bold">{Math.round(c.attendancePercent)}%</p><p className="text-[11px] text-muted">{t('attendance')}</p></div>
                <div className="card p-3"><p className="num text-sm font-bold leading-7">{c.accessUntil ? formatDate(c.accessUntil, lang) : '—'}</p><p className="text-[11px] text-muted">{t('accessUntil')}</p></div>
              </div>

              {!c.expired ? (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" disabled={!room} onClick={() => room && navigate(`/chats/${room.id}`)}>
                    <MessagesSquare className="h-5 w-5" />{t('group')}
                    {!!room?.unreadCount && <span className="num rounded-full bg-white/25 px-1.5 text-xs">{room.unreadCount}</span>}
                  </button>
                  {c.role === 'student' && (
                    <button className="btn-soft" onClick={() => ask.mutate()} disabled={ask.isPending}>
                      <MessageCircleQuestion className="h-5 w-5" />{t('privateQuestion')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl bg-warn/10 p-4 text-sm">
                  <p className="font-bold text-warn">{t('expired')}</p>
                  <a className="mt-2 inline-block font-bold text-accent" href="https://engosoft.com" target="_blank" rel="noreferrer">{t('renew')}</a>
                </div>
              )}

              {c.nextSession && !c.expired && <NextSessionCard session={c.nextSession} instructor={c.instructor?.name} channelId={c.courseChannelId} />}

              {data.weekDays.length > 0 && (
                <div className="card flex flex-wrap items-center gap-2 p-4 text-sm">
                  <CalendarDays className="h-4 w-4 text-muted" />
                  <span className="text-muted">{t('weekDays')}:</span>
                  {data.weekDays.map((d) => <span key={d} className="chip bg-sunken text-ink">{weekday(d, lang)}</span>)}
                </div>
              )}

              {c.courseChannelId && (
                <Link to={`/recorded/${c.courseChannelId}`} className="card lift group flex items-center gap-3 p-3">
                  <CourseCover channelId={c.courseChannelId} title={c.title} className="h-12 w-12" rounded="rounded-xl" />
                  <div className="flex-1">
                    <p className="font-bold">{t('recordedCourses')}</p>
                    <p className="text-xs text-muted">{lang === 'ar' ? 'المحتوى المسجّل المرتبط بالكورس ده' : 'Recorded material for this course'}</p>
                  </div>
                </Link>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ quizzes and tasks

function AssessmentsSection({ eventId, staff, ended }: { eventId: number; staff: boolean; ended: SessionSummary[] }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['assessments', eventId], queryFn: () => api<AssessmentCard[]>(`/api/live-courses/${eventId}/assessments`) })
  const [aiOpen, setAiOpen] = useState(false)

  const create = useMutation({
    mutationFn: (kind: 'quiz' | 'task') => api<AssessmentDetail>(`/api/live-courses/${eventId}/assessments`, {
      method: 'POST',
      json: { kind, title: kind === 'quiz' ? (lang === 'ar' ? 'اختبار جديد' : 'New quiz') : (lang === 'ar' ? 'تاسك جديد' : 'New task'), maxAttempts: 2, passPercent: 60, revealAnswers: true, questions: [] },
    }),
    onSuccess: (a) => navigate(`/assessments/${a.card.id}`),
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  return (
    <Reveal>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-title flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-accent" />{t('assessments')}</h3>
          {staff && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary h-9 px-3 text-sm" onClick={() => setAiOpen(true)}><Sparkles className="h-4 w-4" />{t('aiQuiz')}</button>
              <button className="btn-soft h-9 px-3 text-sm" onClick={() => create.mutate('quiz')}><PenLine className="h-4 w-4" />{t('newQuiz')}</button>
              <button className="btn-soft h-9 px-3 text-sm" onClick={() => create.mutate('task')}><ClipboardList className="h-4 w-4" />{t('newTask')}</button>
            </div>
          )}
        </div>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {data && data.length === 0 && <div className="card p-6 text-center text-sm text-muted">{t('noAssessments')}</div>}
        <Stagger className="grid gap-3 sm:grid-cols-2">
          {data?.map((a) => (
            <StaggerItem key={a.id}>
              <Link to={`/assessments/${a.id}`} className="card lift group block p-4">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className={clsx('chip', a.kind === 'quiz' ? 'bg-brand-50 text-accent' : 'bg-gold/15 text-[#8A5A0B]')}>{a.kind === 'quiz' ? t('quiz') : t('task')}</span>
                  {a.aiGenerated && <span className="chip bg-sunken text-muted"><Bot className="h-3 w-3" />{t('aiMade')}</span>}
                  {staff && <span className={clsx('chip', a.status === 'published' ? 'bg-ok/10 text-ok' : a.status === 'draft' ? 'bg-gold/15 text-[#8A5A0B]' : 'bg-sunken text-muted')}>{t(a.status)}</span>}
                </div>
                <p className="line-clamp-2 font-bold leading-snug" dir="auto">{a.title}</p>
                <p className="mt-2 text-xs text-muted">
                  {a.kind === 'quiz' && <><span className="num">{a.questionCount}</span> {t('question')}</>}
                  {a.dueAt && <> · {t('due')} <span className="num">{formatDate(a.dueAt, lang)}</span></>}
                </p>
                {a.mine && a.mine.attemptsUsed > 0 && (
                  <p className={clsx('mt-2 text-sm font-bold', a.mine.passed ? 'text-ok' : 'text-warn')}>{t('yourScore')} <span className="num">{Math.round(a.mine.bestPercent ?? 0)}%</span></p>
                )}
                {a.myTask?.submittedAt && <p className="mt-2 text-sm font-bold text-ok">{a.myTask.grade != null ? `${t('grade')} ${a.myTask.grade}/100` : t('submitted')}</p>}
                {a.stats && (
                  <p className="mt-2 text-xs text-muted">
                    {a.kind === 'quiz' ? <>{t('results')}: <span className="num">{a.stats.attempts}</span>{a.stats.averagePercent != null && <> · <span className="num">{Math.round(a.stats.averagePercent)}%</span></>}</>
                      : <>{t('submissions')}: <span className="num">{a.stats.submissions}</span>{a.stats.ungraded > 0 && <> · <span className="font-bold text-warn">{a.stats.ungraded} {t('ungraded')}</span></>}</>}
                  </p>
                )}
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
        {staff && <AiQuizSheet open={aiOpen} onClose={() => setAiOpen(false)} sessions={ended} />}
      </section>
    </Reveal>
  )
}

export function AiQuizSheet({ open, onClose, sessions, presetTrackId }: { open: boolean; onClose: () => void; sessions: SessionSummary[]; presetTrackId?: number }) {
  const { t } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [trackId, setTrackId] = useState<number | null>(presetTrackId ?? sessions[0]?.id ?? null)
  const [count, setCount] = useState(8)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  useEffect(() => { if (!trackId && sessions.length) setTrackId(sessions[0].id) }, [sessions, trackId])

  const gen = useMutation({
    mutationFn: () => api<AssessmentDetail>(`/api/sessions/${trackId}/assessments/ai`, { method: 'POST', json: { count, difficulty } }),
    onSuccess: (a) => { onClose(); navigate(`/assessments/${a.card.id}`) },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  return (
    <Sheet open={open} onClose={() => !gen.isPending && onClose()} title={t('aiQuiz')}>
      <div className="space-y-4 pb-3">
        <p className="text-sm text-muted">{t('aiQuizHint')}</p>
        {!presetTrackId && (
          <label className="block">
            <span className="mb-1 block text-sm font-bold">{t('chooseSession')}</span>
            <select className="field" value={trackId ?? ''} onChange={(e) => setTrackId(Number(e.target.value))}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{sessionLabel(s, t)}</option>)}
            </select>
          </label>
        )}
        <div>
          <span className="mb-1 block text-sm font-bold">{t('questionsCount')}: <span className="num">{count}</span></span>
          <input type="range" min={3} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[rgb(var(--brand-500))]" />
        </div>
        <div>
          <span className="mb-1 block text-sm font-bold">{t('difficulty')}</span>
          <Segmented value={difficulty} onChange={setDifficulty} options={[{ value: 'easy', label: t('easy') }, { value: 'medium', label: t('medium') }, { value: 'hard', label: t('hard') }]} />
        </div>
        <button className="btn-primary h-12 w-full" disabled={!trackId || gen.isPending} onClick={() => gen.mutate()}>
          {gen.isPending ? <><Loader2 className="h-5 w-5 animate-spin" />{t('generating')}</> : <><Sparkles className="h-5 w-5" />{t('aiQuiz')}</>}
        </button>
      </div>
    </Sheet>
  )
}
