import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Award, Bell, BellRing, BookOpen, CalendarDays, ClipboardCheck, Download, FileCheck2, MessagesSquare, Share, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { dayKey, formatDate, relativeDay } from '../lib/format'
import { CountUp, Reveal, Stagger, StaggerItem, motion } from '../lib/motion'
import { enablePush, isIos, isStandalone, pushState, type PushState } from '../lib/push'
import { useInstallPrompt } from '../lib/install'
import type { AssessmentCard, Home } from '../lib/types'
import { EmptyState, ErrorState, Logo, Sheet, Skeleton, useToast } from '../components/ui'
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
  const firstName = data?.name.split(' ')[0] ?? ''

  const nextCourse = data?.liveCourses.find((c) => c.eventId === data.nextSession?.eventId)
  const [allUpcoming, setAllUpcoming] = useState(false)
  const laterAll = data?.upcoming.filter((s) => s.id !== data.nextSession?.id) ?? []
  const later = allUpcoming ? laterAll : laterAll.slice(0, 4)

  return (
    <div className="mx-auto max-w-[1280px] md:px-8 md:pt-8">
      {/* Greeting: drafting-paper header with Engineer Majed telling you what is next */}
      <section className="relative overflow-hidden pt-safe md:rounded-[24px] md:border md:border-line md:bg-surface md:shadow-card">
        <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(var(--brand-500)/0.08)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--brand-500)/0.08)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_95%)]" />
        <div className="relative flex h-14 items-center justify-between px-4 md:hidden">
          <Logo className="h-8 w-auto" />
          <Link to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-ink shadow-card" aria-label={t('notifications')}>
            <Bell className="h-5 w-5" />
            {!!badges?.notifications && <span className="absolute end-2 top-2 h-2.5 w-2.5 rounded-full bg-live ring-2 ring-surface" />}
          </Link>
        </div>
        <div className="relative grid gap-6 px-5 pb-6 pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)] md:items-center md:gap-10 md:p-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.45 }}>
            <p className="text-sm font-medium text-muted md:text-base">{greeting(t)}{firstName ? '،' : ''}</p>
            <h1 className="mt-1 font-display text-[30px] font-bold leading-tight md:text-[46px]">{isLoading ? <span className="inline-block h-9 w-48 rounded-lg bg-sunken" /> : firstName || t('hello')}</h1>
            <div className="mt-5 flex items-end gap-2.5">
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-brand-50 ring-2 ring-surface shadow-card">
                <img src="/art/majed.webp" alt="" className="h-[150%] w-full object-cover object-top" />
              </span>
              <p className="max-w-md rounded-[18px] rounded-es-[6px] border border-line bg-surface px-4 py-2.5 text-[14px] leading-6 text-ink shadow-card md:text-[15px]">
                {data?.nextSession
                  ? (lang === 'ar' ? `محاضرتك القادمة ${relativeDay(data.nextSession.start!, lang)}. يُتاح الدخول قبل موعدها بربع ساعة.` : `Your next session is ${relativeDay(data.nextSession.start!, lang)}. You can join 15 minutes before it starts.`)
                  : (lang === 'ar' ? 'تابع دوراتك من حيث توقفت.' : 'Pick up where you left off.')}
              </p>
            </div>
          </motion.div>
          <div className="hidden md:block">
            {data?.nextSession && <NextSessionCard session={data.nextSession} instructor={nextCourse?.instructor?.name} channelId={nextCourse?.courseChannelId} />}
          </div>
        </div>
      </section>

      <div className="relative space-y-8 px-4 md:mt-8 md:px-0">
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        <div className="md:hidden">
          {isLoading ? <Skeleton className="h-[150px] w-full rounded-2xl" /> : data?.nextSession ? (
            <NextSessionCard session={data.nextSession} instructor={nextCourse?.instructor?.name} channelId={nextCourse?.courseChannelId} />
          ) : data ? (
            <div className="card flex items-center gap-4 p-5">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-accent"><CalendarDays className="h-6 w-6" /></div>
              <p className="flex-1 font-bold">{t('noUpcoming')}</p>
            </div>
          ) : null}
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            {pending.data && pending.data.length > 0 && (
              <Reveal>
                <section>
                  <h2 className="section-title mb-3 flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-accent" />{t('pendingWork')}</h2>
                  <Stagger className="grid gap-3 sm:grid-cols-2">
                    {pending.data.map((a) => (
                      <StaggerItem key={a.id}>
                        <Link to={`/assessments/${a.id}`} className="card lift group flex items-center gap-3 overflow-hidden p-3">
                          <img src="/art/exam.webp" alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                          <div className="min-w-0 flex-1">
                            <span className={clsx('chip mb-1', a.kind === 'quiz' ? 'bg-brand-50 text-accent' : 'bg-gold/15 text-[#8A5A0B]')}>
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
                  <h2 className="section-title mb-3">{t('upcoming')}</h2>
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
                    <h2 className="section-title">{t('continueLearning')}</h2>
                    <Link to="/courses?tab=recorded" className="text-sm font-bold text-accent hover:underline">{t('seeAll')}</Link>
                  </div>
                  <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 xl:grid-cols-3">
                    {data.continueLearning.slice(0, 6).map((c) => <RecordedCourseTile key={c.channelId} c={c} />)}
                  </div>
                </section>
              </Reveal>
            )}

            {data && data.liveCourses.length > 0 && (
              <Reveal>
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="section-title">{t('myLiveCourses')}</h2>
                    <Link to="/courses?tab=live" className="text-sm font-bold text-accent hover:underline">{t('seeAll')}</Link>
                  </div>
                  <Stagger className="grid gap-3 md:grid-cols-2 md:gap-5 xl:grid-cols-3">
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
            {data && (
              <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
                {[
                  { to: '/courses?tab=live', icon: CalendarDays, value: data.liveCourses.length, label: t('liveCourses'), tone: 'text-accent' },
                  { to: '/chats', icon: MessagesSquare, value: badges?.messages ?? data.unreadMessages, label: t('newMessages'), tone: 'text-accent' },
                  { to: '/certificates', icon: Award, value: data.certificateCount, label: t('certificates'), tone: 'text-gold' },
                ].map(({ to, icon: Icon, value, label, tone }) => (
                  <Link key={to} to={to} className="card lift flex flex-col items-start gap-1 p-3 lg:flex-row lg:items-center lg:gap-4 lg:p-4">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-sunken lg:h-11 lg:w-11"><Icon className={clsx('h-5 w-5', tone)} /></span>
                    <CountUp value={value} className="num text-xl font-bold lg:order-last lg:text-2xl" />
                    <span className="text-[12px] text-muted lg:flex-1 lg:text-sm">{label}</span>
                  </Link>
                ))}
              </div>
            )}
            <SetupCard />
            {pending.data && pending.data.length === 0 && data && (
              <div className="card flex items-center gap-3 p-4 text-sm"><FileCheck2 className="h-5 w-5 text-ok" />{t('allDone')}</div>
            )}
          </aside>
        </div>
      </div>
    </div>
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
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-[#B7791F]">
            {needsInstall ? <Download className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <p className="font-bold">{needsInstall ? t('installApp') : t('enablePush')}</p>
            <p className="mt-0.5 text-sm text-muted">{needsInstall ? t('installWhy') : t('pushWhy')}</p>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary h-9 px-4 text-sm" onClick={act}>
                <Sparkles className="h-4 w-4" />{needsInstall ? t('install') : t('enablePush')}
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
