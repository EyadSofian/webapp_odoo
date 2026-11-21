import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Award, BookOpenText, CheckCircle2, ChevronDown, FileText, HelpCircle, Image, PlayCircle } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/format'
import type { LessonType, RecordedCourseDetail } from '../lib/types'
import { CourseCover, ErrorState, Skeleton, TopBar } from '../components/ui'
import { CourseCrumb, CourseHeader } from '../components/learning'

export function lessonIcon(type: LessonType) {
  switch (type) {
    case 'video': return PlayCircle
    case 'article': return BookOpenText
    case 'infographic': return Image
    case 'quiz': return HelpCircle
    case 'certification': return Award
    default: return FileText
  }
}

export function RecordedCourseScreen() {
  const { channelId } = useParams()
  const { t, lang } = useI18n()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['course', channelId],
    queryFn: () => api<RecordedCourseDetail>(`/api/courses/${channelId}`),
  })
  const [open, setOpen] = useState<Record<number, boolean>>({})

  const c = data?.course
  const all = data?.sections.flatMap((s) => s.lessons) ?? []
  const doneCount = all.filter((l) => l.completed).length
  const firstOpen = data?.sections.findIndex((s) => s.lessons.some((l) => l.id === c?.nextLessonId)) ?? 0

  const nextLesson = all.find((l) => l.id === c?.nextLessonId)
  const totalMinutes = all.reduce((sum, l) => sum + (l.minutes || 0), 0)

  return (
    <div className="mx-auto max-w-[1280px]">
      <TopBar back title={c ? <CourseCrumb title={c.title} to="/courses?tab=recorded" /> : undefined} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4 md:p-8"><Skeleton className="h-72 w-full" /><Skeleton className="h-72 w-full" /></div>}

      {c && data && (
        <div className="animate-fade-up">
          <CourseHeader
            cover={<CourseCover channelId={c.channelId} title={c.title} className="aspect-video w-full md:rounded-[16px]" rounded="rounded-none" />}
            chips={<>
              <span className="chip bg-brand-50 text-accent">{t('recorded')}</span>
              {c.expired && <span className="chip bg-warn/10 text-warn">{t('expired')}</span>}
            </>}
            title={c.title}
            description={data.description}
            stats={[
              { value: `${Math.round(c.completion)}%`, label: t('progress') },
              { value: <>{doneCount}<span className="text-sm font-semibold text-muted">/{all.length}</span></>, label: t('lessons') },
              ...(totalMinutes > 0 ? [{ value: <>{Math.round(totalMinutes / 6) / 10}</>, label: t('hours') }] : []),
              ...(c.accessUntil ? [{ value: <span className="text-[16px] md:text-[17px]">{formatDate(c.accessUntil, lang)}</span>, label: t('accessUntil') }] : []),
            ]}
            actions={c.nextLessonId && !c.expired ? (
              <Link to={`/lessons/${c.nextLessonId}`} className="btn-primary h-11 px-5">
                <PlayCircle className="h-5 w-5" />{doneCount ? t('continue') : t('start')}
              </Link>
            ) : c.expired ? <a className="btn-soft h-11 px-5" href="https://engosoft.com" target="_blank" rel="noreferrer">{t('renew')}</a> : undefined}
          />

          <div className="grid grid-cols-1 gap-6 px-4 py-5 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
            <aside className="space-y-4 lg:order-last lg:sticky lg:top-24 lg:self-start">
              {nextLesson && !c.expired && (
                <Link to={`/lessons/${nextLesson.id}`} className="card lift group block p-4">
                  <p className="text-xs font-semibold text-muted">{doneCount ? t('continueLearning') : t('start')}</p>
                  <p className="mt-2 line-clamp-2 font-bold leading-snug" dir="auto">{nextLesson.title}</p>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="num text-muted">{nextLesson.minutes > 0 ? `${nextLesson.minutes} ${t('minutes')}` : ''}</span>
                    <span className="flex items-center gap-1.5 font-bold text-accent"><PlayCircle className="h-4 w-4" />{doneCount ? t('continue') : t('start')}</span>
                  </div>
                </Link>
              )}
              {c.completion >= 100 && (
                <Link to="/certificates" className="card lift flex items-center gap-3 p-4">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold/15 text-[#B7791F]"><Award className="h-5 w-5" /></span>
                  <span className="flex-1 font-bold">{t('certificates')}</span>
                </Link>
              )}
            </aside>

            <div className="min-w-0">
              <h3 className="section-title mb-3 md:text-[20px]">{t('lessons')}</h3>
            <div className="space-y-3">
              {data.sections.map((section, i) => {
                const expanded = open[i] ?? i === Math.max(0, firstOpen)
                const sDone = section.lessons.filter((l) => l.completed).length
                return (
                  <section key={section.id ?? i} className="card overflow-hidden">
                    <button className="flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => setOpen((o) => ({ ...o, [i]: !expanded }))} aria-expanded={expanded}>
                      <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-accent">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold" dir="auto">{section.title || t('lessons')}</span>
                        <span className="num text-xs text-muted">{sDone}/{section.lessons.length}</span>
                      </span>
                      <ChevronDown className={clsx('h-5 w-5 text-muted transition', expanded && 'rotate-180')} />
                    </button>
                    {expanded && (
                      <ul className="border-t border-line/70">
                        {section.lessons.map((l) => {
                          const Icon = lessonIcon(l.type)
                          const current = l.id === c.nextLessonId
                          return (
                            <li key={l.id}>
                              <Link to={`/lessons/${l.id}`} className={clsx('flex items-center gap-3 px-4 py-3', current && 'bg-brand-50/60')}>
                                {l.completed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" /> : <Icon className={clsx('h-5 w-5 shrink-0', current ? 'text-accent' : 'text-muted')} />}
                                <span className={clsx('min-w-0 flex-1 truncate text-[15px]', l.completed && 'text-muted')} dir="auto">{l.title}</span>
                                {l.minutes > 0 && <span className="num shrink-0 text-xs text-muted">{l.minutes} {t('minutes')}</span>}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
