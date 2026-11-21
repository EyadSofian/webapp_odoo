import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Award, Bell, BellRing, BookOpen, CalendarDays, ClipboardCheck, Download, FileCheck2, MessagesSquare, PlayCircle, Share, Video } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { dayKey, formatDate, formatTime, relativeDay } from '../lib/format'
import { CountUp, Reveal, Stagger, StaggerItem, motion } from '../lib/motion'
import { enablePush, isIos, isStandalone, pushState, type PushState } from '../lib/push'
import { useInstallPrompt } from '../lib/install'
import type { AssessmentCard, Home } from '../lib/types'
import { Avatar, EmptyState, ErrorState, Sheet, Skeleton, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { LiveCourseItem, NextSessionCard, RecordedCourseTile, SessionRow } from '../components/learning'
import { useBadges } from '../components/AppShell'

function greeting(t: (k: 'goodMorning' | 'goodEvening') => string) {
  return new Date().getHours() < 12 ? t('goodMorning') : t('goodEvening')
}

export function HomeScreen() {
  const { t, lang } = useI18n()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['home'], queryFn: () => api<Home>('/api/home'), refetchInterval: 120_000 })
  const pending = useQuery({ queryKey: ['pending-assessments'], queryFn: () => api<AssessmentCard[]>('/api/assessments/pending') })
  const { data: badges } = useBadges()
  const { user } = useAuth()
  const firstName = data?.name.split(' ')[0] ?? ''

  const nextCourse = data?.liveCourses.find((c) => c.eventId === data.nextSession?.eventId)
  const [allUpcoming, setAllUpcoming] = useState(false)
  const laterAll = data?.upcoming.filter((s) => s.id !== data.nextSession?.id) ?? []
  const later = allUpcoming ? laterAll : laterAll.slice(0, 4)

  return (
    <div className="mx-auto max-w-[1280px] md:px-8 md:pt-8">
      {/* Header: the royal blue of engosoft.com, with the counters as glass tiles over it */}
      <section className="relative isolate overflow-hidden rounded-b-[32px] bg-[linear-gradient(155deg,rgb(var(--hero-from)),rgb(var(--hero-to)))] pt-safe text-white shadow-[0_18px_40px_-24px_rgb(var(--hero-to)/0.9)] md:rounded-[28px]">
        {/* Light behind the glass: brighter blue in the same hue, plus the Engosoft orbit */}
        <div aria-hidden className="pointer-events-none absolute -top-24 start-[-80px] -z-10 h-64 w-64 rounded-full bg-brand-400/60 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 end-[-60px] -z-10 h-56 w-56 rounded-full bg-sky/40 blur-3xl" />
        <HeroOrbit />
        <div className="relative flex h-16 items-center gap-3 px-5 md:hidden">
          <Link to="/profile" className="shrink-0 rounded-full ring-2 ring-white/40" aria-label={t('profile')}>
            <Avatar partnerId={user?.partnerId} name={user?.name ?? ''} size={40} />
          </Link>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[13px] text-white/80">{greeting(t)}</p>
            <p className="truncate text-[17px] font-bold">{isLoading ? '…' : firstName || t('hello')}</p>
          </div>
          <Link to="/notifications" className="glass relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/25" aria-label={t('notifications')}>
            <Bell className="h-5 w-5" />
            {!!badges?.notifications && <span className="absolute end-2 top-2 h-2.5 w-2.5 rounded-full bg-live ring-2 ring-brand-600" />}
          </Link>
        </div>
        <div className="relative grid grid-cols-1 gap-6 px-5 pb-5 pt-2 md:grid-cols-[minmax(0,1fr)_minmax(0,400px)] md:items-center md:gap-10 md:p-10">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}>
            <p className="hidden text-base text-white/80 md:block">{greeting(t)}{firstName ? '،' : ''}</p>
            <h1 className="hidden font-display text-[40px] font-bold leading-tight md:mt-1 md:block">{firstName || t('hello')}</h1>
            <p className="font-display text-[22px] font-bold leading-snug md:mt-2 md:max-w-md md:text-[18px] md:font-medium md:leading-7 md:text-white/90">
              {data?.nextSession
                ? (lang === 'ar' ? `محاضرتك القادمة ${relativeDay(data.nextSession.start!, lang)} الساعة ${formatTime(data.nextSession.start, lang)}` : `Your next session is ${relativeDay(data.nextSession.start!, lang)} at ${formatTime(data.nextSession.start, lang)}`)
                : (lang === 'ar' ? 'أكمل دوراتك من آخر درس وصلت إليه' : 'Pick up from the last lesson you reached')}
            </p>
            {data?.nextSession && <p className="mt-1 line-clamp-1 text-[14px] text-white/80" dir="auto">{data.nextSession.eventTitle}</p>}

            <div className="mt-5 grid grid-cols-3 gap-2.5 md:mt-7 md:max-w-xl md:gap-3">
              {[
                { to: '/courses?tab=live', value: data?.liveCourses.length, label: t('liveCourses'), icon: Video, chip: 'bg-white text-brand-500' },
                { to: '/chats', value: badges?.messages ?? data?.unreadMessages, label: t('newMessages'), icon: MessagesSquare, chip: 'bg-green text-white shadow-[0_6px_14px_-4px_rgb(var(--green)/0.8)]' },
                { to: '/certificates', value: data?.certificateCount, label: t('certificates'), icon: Award, chip: 'bg-orange text-white shadow-[0_6px_14px_-4px_rgb(var(--orange)/0.8)]' },
              ].map(({ to, value, label, icon: Icon, chip }) => (
                <Link key={to} to={to} className="glass flex flex-col gap-2.5 rounded-2xl p-3 transition-[transform,background-color] active:scale-[0.98] active:bg-white/25 md:p-4">
                  <span className={clsx('grid h-9 w-9 place-items-center rounded-xl', chip)}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    {value === undefined
                      ? <span className="block h-7 w-8 rounded-md bg-white/20" />
                      : <CountUp value={value} className="num block text-[24px] font-bold leading-7" />}
                    <span className="block truncate text-[12px] text-white/85 md:text-[13px]">{label}</span>
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
          <div className="relative hidden md:block">
            {data?.nextSession
              ? <NextSessionCard session={data.nextSession} instructor={nextCourse?.instructor?.name} channelId={nextCourse?.courseChannelId} />
              : data?.continueLearning[0]
                ? <div><p className="mb-2 text-sm font-semibold text-white/85">{t('continueLearning')}</p><RecordedCourseTile c={data.continueLearning[0]} wide /></div>
                : null}
          </div>
        </div>
      </section>

      <div className="relative space-y-8 px-4 pt-5 md:mt-8 md:px-0 md:pt-0">
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        <div className="md:hidden">
          {isLoading ? <Skeleton className="h-[150px] w-full rounded-2xl" /> : data?.nextSession ? (
            <NextSessionCard session={data.nextSession} instructor={nextCourse?.instructor?.name} channelId={nextCourse?.courseChannelId} />
          ) : data ? (
            <div className="card flex items-center gap-4 p-5">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-white shadow-[0_8px_18px_-8px_rgb(var(--brand-500)/0.9)]"><CalendarDays className="h-6 w-6" /></div>
              <div className="flex-1">
                <p className="font-bold">{t('noUpcoming')}</p>
                <p className="text-sm text-muted">{lang === 'ar' ? 'ستظهر هنا مواعيد محاضراتك المباشرة.' : 'Your live session times show up here.'}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            {pending.data && pending.data.length > 0 && (
              <Reveal>
                <section>
                  <SectionTitle className="mb-3" icon={ClipboardCheck} tone="orange">{t('pendingWork')}</SectionTitle>
                  <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {pending.data.map((a) => (
                      <StaggerItem key={a.id}>
                        <Link to={`/assessments/${a.id}`} className="card lift group flex items-center gap-3 overflow-hidden p-3">
                          <img src="/art/exam.webp" alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                          <div className="min-w-0 flex-1">
                            <span className={clsx('chip mb-1', a.kind === 'quiz' ? 'bg-blue-soft text-accent' : 'bg-orange-soft text-orange-ink')}>
                              {a.kind === 'quiz' ? t('quiz') : t('task')}{a.aiGenerated && ` · ${t('aiMade')}`}
                            </span>
                            <p className="line-clamp-2 font-bold leading-snug" dir="auto">{a.title}</p>
                            {a.dueAt && <p className="text-xs text-muted">{t('due')} <span className="num">{formatDate(a.dueAt, lang)}</span></p>}
                          </div>
                          <ArrowLeft className="h-5 w-5 shrink-0 text-muted transition group-hover:-translate-x-1 ltr:rotate-180" />
                        </Link>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </section>
              </Reveal>
            )}

            {later.length > 0 && (
              <Reveal>
                <section>
                  <SectionTitle className="mb-3" icon={CalendarDays} tone="blue">{t('upcoming')}</SectionTitle>
                  <div className="card divide-y divide-line/70 px-4 md:px-5">
                    {later.map((s, i) => (
                      <div key={s.id}>
                        {(i === 0 || dayKey(later[i - 1].start!) !== dayKey(s.start!)) && <p className="pt-3 text-xs font-bold text-muted">{relativeDay(s.start!, lang)}</p>}
                        <SessionRow s={s} compact />
                      </div>
                    ))}
                    {laterAll.length > 4 && (
                      <button className="w-full py-3 text-sm font-bold text-accent" onClick={() => setAllUpcoming((v) => !v)}>
                        {allUpcoming ? (lang === 'ar' ? 'عرض أقل' : 'Show less') : `${t('seeAll')} (${laterAll.length})`}
                      </button>
                    )}
                  </div>
                </section>
              </Reveal>
            )}

            {isLoading ? <Skeleton className="h-56 w-full" /> : data && data.continueLearning.length > 0 && (
              <Reveal>
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle icon={PlayCircle} tone="sky">{t('continueLearning')}</SectionTitle>
                    <Link to="/courses?tab=recorded" className="text-sm font-bold text-sky-ink hover:underline">{t('seeAll')}</Link>
                  </div>
                  <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 xl:grid-cols-3">
                    {data.continueLearning.slice(0, 6).map((c, i) => (
                      // On desktop the first one is already in the header when there is no upcoming session.
                      <div key={c.channelId} className={clsx('contents', i === 0 && !data.nextSession && 'md:hidden')}><RecordedCourseTile c={c} /></div>
                    ))}
                  </div>
                </section>
              </Reveal>
            )}

            {data && data.liveCourses.length > 0 && (
              <Reveal>
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle icon={Video} tone="blue">{t('myLiveCourses')}</SectionTitle>
                    <Link to="/courses?tab=live" className="text-sm font-bold text-accent hover:underline">{t('seeAll')}</Link>
                  </div>
                  <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5 xl:grid-cols-3">
                    {data.liveCourses.slice(0, 6).map((c) => <StaggerItem key={c.eventId}><LiveCourseItem c={c} /></StaggerItem>)}
                  </Stagger>
                </section>
              </Reveal>
            )}

            {data && data.liveCourses.length === 0 && data.continueLearning.length === 0 && (
              <EmptyState image="/art/empty-courses.webp" icon={<BookOpen className="h-7 w-7" />} title={lang === 'ar' ? 'لا توجد دورات في حسابك بعد' : 'No courses on your account yet'}
                body={lang === 'ar' ? 'ستظهر هنا أي دورة تشترك فيها من موقع إنجوسوفت.' : 'Courses you join on engosoft.com show up here.'}
                action={<a className="btn-primary" href={data.websiteUrl} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>} />
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <SetupCard />
            {pending.data && pending.data.length === 0 && data && (
              <div className="card flex items-center gap-3 p-4 text-sm"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-ok/10 text-ok"><FileCheck2 className="h-[18px] w-[18px]" /></span>{t('allDone')}</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const TONES = {
  blue: 'bg-brand-500',
  sky: 'bg-sky',
  orange: 'bg-orange',
  green: 'bg-green',
} as const

/** Each section carries its color: blue for live sessions, sky for recorded learning, orange for work to hand in. */
function SectionTitle({ icon: Icon, tone, className, children }: { icon: typeof Video; tone: keyof typeof TONES; className?: string; children: ReactNode }) {
  return (
    <h2 className={clsx('section-title flex items-center gap-2.5', className)}>
      <span className={clsx('grid h-8 w-8 place-items-center rounded-[10px] text-white', TONES[tone])}><Icon className="h-[18px] w-[18px]" strokeWidth={2} /></span>
      {children}
    </h2>
  )
}

/** Gets the app installed and notifications on: the two things that make reminders reach the learner. */
function SetupCard() {
  const { t } = useI18n()
  const toast = useToast()
  const [state, setState] = useState<PushState>(pushState)
  const [guide, setGuide] = useState(false)
  const install = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem('engosoft.setup-dismissed') === '1' } catch { return false } })

  if (dismissed || state === 'granted' || state === 'unsupported') return null
  const needsInstall = state === 'needs-install'

  const act = async () => {
    if (needsInstall) {
      if (install.canPrompt) await install.prompt()
      else setGuide(true)
      return
    }
    const next = await enablePush().catch(() => 'default' as PushState)
    setState(next)
    if (next === 'granted') toast({ kind: 'ok', text: t('pushOn') })
    else if (next === 'denied') toast({ kind: 'error', text: t('pushBlocked') })
  }

  return (
    <>
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange text-white">
            {needsInstall ? <Download className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <p className="font-bold">{needsInstall ? t('installApp') : t('enablePush')}</p>
            <p className="mt-0.5 text-sm text-muted">{needsInstall ? t('installWhy') : t('pushWhy')}</p>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary h-9 px-4 text-sm" onClick={act}>
                {needsInstall ? t('install') : t('enablePush')}
              </button>
              <button className="btn-ghost h-9 px-3 text-sm text-muted" onClick={() => {
                setDismissed(true)
                try { localStorage.setItem('engosoft.setup-dismissed', '1') } catch { /* ignore */ }
              }}>{t('later')}</button>
            </div>
          </div>
        </div>
      </div>
      <Sheet open={guide} onClose={() => setGuide(false)} title={t('installApp')}>
        <ol className="space-y-4 pb-4">
          {[
            { icon: <Share className="h-5 w-5" />, text: t('installIos1') },
            { icon: <Download className="h-5 w-5" />, text: t('installIos2') },
            { icon: <BellRing className="h-5 w-5" />, text: t('installIos3') },
          ].map((step, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-accent">{i + 1}</span>
              <span className="text-accent">{step.icon}</span>
              <span className="text-[15px]">{step.text}</span>
            </li>
          ))}
        </ol>
        {isIos() && !isStandalone() && <p className="pb-2 text-xs text-muted">iOS 16.4+ · Safari</p>}
      </Sheet>
    </>
  )
}

/** The three dots of the Engosoft mark on slow orbits: quiet motion that belongs to the brand. Still when motion is reduced. */
function HeroOrbit() {
  return (
    <div aria-hidden className="pointer-events-none absolute -bottom-40 end-[-170px] h-[340px] w-[340px] text-white opacity-60 md:end-[40px] md:top-1/2 md:h-[520px] md:w-[520px] md:-translate-y-1/2">
      <svg viewBox="0 0 400 400" className="h-full w-full">
        <g className="animate-[spin_70s_linear_infinite]" style={{ transformOrigin: '200px 200px' }}>
          <circle cx="200" cy="200" r="190" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.25" strokeDasharray="2 9" />
          <circle cx="200" cy="10" r="6" fill="currentColor" fillOpacity="0.45" />
        </g>
        <g className="animate-[spin_45s_linear_infinite_reverse]" style={{ transformOrigin: '200px 200px' }}>
          <circle cx="200" cy="200" r="138" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.25" />
          <circle cx="338" cy="200" r="4.5" fill="currentColor" fillOpacity="0.55" />
          <circle cx="62" cy="200" r="3" fill="currentColor" fillOpacity="0.35" />
        </g>
        <circle cx="200" cy="200" r="86" fill="currentColor" fillOpacity="0.06" />
      </svg>
    </div>
  )
}

