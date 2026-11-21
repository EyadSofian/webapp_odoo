import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CalendarDays, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { LiveCourseCard, RecordedCourseCard } from '../lib/types'
import { EmptyState, ErrorState, Segmented, Skeleton, TopBar } from '../components/ui'
import { LiveCourseItem, RecordedCourseTile } from '../components/learning'

const WEBSITE = 'https://engosoft.com'

export function CoursesScreen() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') === 'recorded' ? 'recorded' : 'live') as 'live' | 'recorded'

  const live = useQuery({ queryKey: ['live-courses'], queryFn: () => api<LiveCourseCard[]>('/api/live-courses'), enabled: tab === 'live' })
  const recorded = useQuery({ queryKey: ['courses'], queryFn: () => api<RecordedCourseCard[]>('/api/courses'), enabled: tab === 'recorded' })
  const q = tab === 'live' ? live : recorded

  const active = live.data?.filter((c) => !c.expired) ?? []
  const expired = live.data?.filter((c) => c.expired) ?? []

  return (
    <div className="mx-auto max-w-[1400px]">
      <TopBar title={t('courses')} actions={
        <a href={WEBSITE} target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3 text-sm text-accent"><Plus className="h-4 w-4" />{t('browseMore')}</a>
      } />
      <div className="px-4 pt-3 md:max-w-md md:px-8">
        <Segmented value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[{ value: 'live', label: t('liveCourses') }, { value: 'recorded', label: t('recordedCourses') }]} />
      </div>

      <div className="px-4 py-4 md:px-8 md:py-6">
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.isLoading && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[100px] w-full" />)}</div>}

        {tab === 'live' && live.data && (
          live.data.length === 0
            ? <EmptyState icon={<CalendarDays className="h-7 w-7" />} title={t('liveCourses')} body={t('chatsEmpty')} />
            : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5 lg:grid-cols-3 2xl:grid-cols-4">{active.map((c) => <LiveCourseItem key={c.eventId} c={c} />)}</div>
                {expired.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-sm font-bold text-muted md:text-base">{t('expired')}</h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5 lg:grid-cols-3 2xl:grid-cols-4">{expired.map((c) => <LiveCourseItem key={c.eventId} c={c} />)}</div>
                  </section>
                )}
              </div>
            )
        )}

        {tab === 'recorded' && recorded.data && (
          recorded.data.length === 0
            ? <EmptyState image="/art/empty-courses.webp" icon={<BookOpen className="h-7 w-7" />} title={t('recordedCourses')}
                action={<a className="btn-primary" href={WEBSITE} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>} />
            : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3 2xl:grid-cols-4">{recorded.data.map((c) => <RecordedCourseTile key={c.channelId} c={c} wide />)}</div>
        )}
      </div>
    </div>
  )
}
