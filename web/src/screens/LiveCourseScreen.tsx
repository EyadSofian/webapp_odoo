import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bot, CalendarDays, ChevronDown, ClipboardCheck, ClipboardList, Hash, Loader2, Lock, MessageCircleQuestion, MessagesSquare, PenLine, Sparkles, UserRound } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate, weekday } from '../lib/format'
import { Reveal, Stagger, StaggerItem, motion } from '../lib/motion'
import type { AssessmentCard, AssessmentDetail, LiveCourseDetail, RoomListItem, SessionSummary } from '../lib/types'
import { CourseCover, ErrorState, Segmented, Sheet, Skeleton, TopBar, useToast } from '../components/ui'
import { CourseCrumb, CourseHeader, NextSessionCard, SessionRow, modeLabel, sessionLabel } from '../components/learning'

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
    <div className="mx-auto max-w-[1280px]">
      <TopBar back title={c ? <CourseCrumb title={c.title} to="/courses?tab=live" /> : undefined} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4 md:p-8"><Skeleton className="h-72 w-full" /><Skeleton className="h-64 w-full" /></div>}

      {c && data && (
        <>
          <CourseHeader
            cover={<CourseCover eventId={c.eventId} title={c.title} className="aspect-video w-full md:rounded-[16px]" rounded="rounded-none" />}
            chips={<>
              {c.code && <span className="chip bg-sunken text-ink"><Hash className="h-3 w-3" /><span className="num">{c.code}</span></span>}
              <span className="chip bg-brand-50 text-accent">{modeLabel(c.mode, t)}</span>
              {c.expired && <span className="chip bg-warn/10 text-warn"><Lock className="h-3 w-3" />{t('expired')}</span>}
            </>}
            title={c.title}
            meta={c.instructor && <span className="flex items-center gap-1.5"><UserRound className="h-4 w-4" /><bdi>{c.instructor.name}</bdi></span>}
            stats={[
              { value: <>{done}<span className="text-sm font-semibold text-muted">/{c.sessionsTotal}</span></>, label: t('sessionsDone') },
              ...(staff ? [] : [{ value: `${Math.round(c.attendancePercent)}%`, label: t('attendance') }]),
              { value: <span className="text-[16px] md:text-[17px]">{c.accessUntil ? formatDate(c.accessUntil, lang) : '—'}</span>, label: t('accessUntil') },
            ]}
            actions={!c.expired ? <>
              <button className="btn-primary h-11 px-5" disabled={!room} onClick={() => room && navigate(`/chats/${room.id}`)}>
                <MessagesSquare className="h-5 w-5" />{t('group')}
                {!!room?.unreadCount && <span className="num rounded-full bg-white/25 px-1.5 text-xs">{room.unreadCount}</span>}
              </button>
              {c.role === 'student' && (
                <button className="btn-soft h-11 px-5" onClick={() => ask.mutate()} disabled={ask.isPending}>
                  <MessageCircleQuestion className="h-5 w-5" />{t('askPrivately')}
                </button>
              )}
            </> : (
              <a className="btn-soft h-11 px-5" href="https://engosoft.com" target="_blank" rel="noreferrer">{t('renew')}</a>
            )}
          />

          <div className="grid grid-cols-1 gap-6 px-4 py-5 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
            <div className="min-w-0 space-y-6">
              <Reveal>
                <section>
                  <div className="mb-3 flex items-end justify-between">
                    <h3 className="section-title md:text-[20px]">{t('sessions')}</h3>
                    <span className="num text-sm text-muted">{c.sessionsTotal} {t('sessions')}</span>
                  </div>
                  <div className="card divide-y divide-line/70 px-4 md:px-5">
                    {upcoming.map((s) => (
                      <div key={s.id} id={`session-${s.id}`} className={clsx(highlight === s.id && '-mx-4 bg-brand-50/60 px-4 md:-mx-5 md:px-5')}><SessionRow s={s} /></div>
                    ))}
                    {past.length > 0 && (
                      <button className="flex w-full items-center justify-center gap-2 py-3 text-sm font-bold text-accent" onClick={() => setShowPast((v) => !v)}>
                        <ChevronDown className={clsx('h-4 w-4 transition-transform', showPast && 'rotate-180')} />
                        {lang === 'ar' ? `المحاضرات السابقة (${past.length})` : `Past sessions (${past.length})`}
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
              {c.nextSession && !c.expired && (
                <div>
                  <h3 className="section-title mb-3 md:text-[20px]">{t('nextSession')}</h3>
                  <NextSessionCard session={c.nextSession} instructor={c.instructor?.name} channelId={c.courseChannelId} />
                </div>
              )}

              {data.weekDays.length > 0 && (
                <div className="card p-4">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted"><CalendarDays className="h-4 w-4" />{t('weekDays')}</p>
                  <div className="flex flex-wrap gap-2">{data.weekDays.map((d) => <span key={d} className="chip h-8 bg-sunken px-3 text-[13px] text-ink">{weekday(d, lang)}</span>)}</div>
                </div>
              )}

              {c.courseChannelId && (
                <Link to={`/recorded/${c.courseChannelId}`} className="card lift group flex items-center gap-3 p-3">
                  <CourseCover channelId={c.courseChannelId} title={c.title} className="aspect-video w-24 shrink-0" rounded="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{t('recordedCourses')}</p>
                    <p className="text-xs text-muted">{lang === 'ar' ? 'المحتوى المسجّل المرتبط بهذه الدورة' : 'Recorded material for this course'}</p>
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
      json: { kind, title: kind === 'quiz' ? (lang === 'ar' ? 'اختبار جديد' : 'New quiz') : (lang === 'ar' ? 'مهمة جديدة' : 'New task'), maxAttempts: 2, passPercent: 60, revealAnswers: true, questions: [] },
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
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
