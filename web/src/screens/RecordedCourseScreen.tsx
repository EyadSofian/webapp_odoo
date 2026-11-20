import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Award, BookOpenText, CheckCircle2, ChevronDown, FileText, HelpCircle, Image, PlayCircle } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/format'
import type { LessonType, RecordedCourseDetail } from '../lib/types'
import { CourseCover, ErrorState, ProgressRing, Skeleton, TopBar } from '../components/ui'

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

  return (
    <div className="mx-auto max-w-6xl">
      <TopBar back title={c?.title} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4"><Skeleton className="aspect-video w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-72 w-full" /></div>}

      {c && data && (
        <div className="animate-fade-up">
          <div className="md:mx-8 md:mt-2 md:overflow-hidden md:rounded-[28px]"><CourseCover channelId={c.channelId} title={c.title} className="aspect-[16/8] w-full md:aspect-[16/5]" rounded="rounded-none" /></div>
          <div className="space-y-5 px-4 py-4 md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:space-y-0 md:px-8 md:py-8">
            <div className="space-y-5 md:order-last md:sticky md:top-24 md:self-start">
            <div>
              <h2 className="font-display text-xl font-bold leading-snug md:text-2xl" dir="auto">{c.title}</h2>
              {data.description && <p className="mt-2 line-clamp-3 text-sm text-muted">{data.description}</p>}
            </div>

            <div className="card flex items-center gap-4 p-4">
              <ProgressRing value={c.completion} size={58} stroke={5} />
              <div className="flex-1">
                <p className="font-bold"><span className="num">{doneCount}</span> {t('of')} <span className="num">{all.length}</span> {t('lessons')}</p>
                <p className="text-xs text-muted">
                  {c.accessUntil ? <>{t('accessUntil')} <span className="num">{formatDate(c.accessUntil, lang)}</span></> : null}
                  {c.expired && <span className="font-bold text-warn"> · {t('expired')}</span>}
                </p>
              </div>
              {c.nextLessonId && !c.expired && (
                <Link to={`/lessons/${c.nextLessonId}`} className="btn-primary h-10 px-4 text-sm">
                  <PlayCircle className="h-4 w-4" />{doneCount ? t('continue') : t('start')}
                </Link>
              )}
            </div>
            </div>

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
      )}
    </div>
  )
}
