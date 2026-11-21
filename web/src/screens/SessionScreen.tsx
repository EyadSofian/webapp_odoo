import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, FileArchive, FileText, FileImage, Video } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDay, formatTime } from '../lib/format'
import type { SessionDetail } from '../lib/types'
import { EmptyState, ErrorState, SessionPill, Skeleton, TopBar, useToast } from '../components/ui'
import { useJoin } from '../components/learning'

function fileIcon(ext: string | null) {
  if (!ext) return FileText
  if (['zip', 'rar', '7z'].includes(ext)) return FileArchive
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return FileImage
  return FileText
}

export function SessionScreen() {
  const { trackId } = useParams()
  const { t, lang } = useI18n()
  const toast = useToast()
  const { join, busy } = useJoin()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['session', trackId],
    queryFn: () => api<SessionDetail>(`/api/sessions/${trackId}`),
  })

  const openFile = async (id: number) => {
    const win = window.open('', '_blank')
    try {
      const { url } = await api<{ url: string }>(`/api/documents/${id}`)
      if (win) win.location.href = url
      else window.location.href = url
    } catch (e) {
      win?.close()
      toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) })
    }
  }

  const s = data?.session
  return (
    <div className="mx-auto min-h-dvh max-w-3xl bg-bg lg:max-w-[1280px]">
      <TopBar back title={s ? `${t('session')} ${s.number}` : t('session')} subtitle={s?.eventTitle} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4"><Skeleton className="aspect-video w-full" /><Skeleton className="h-20 w-full" /></div>}

      {data && s && (
        <div className="animate-fade-up lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8 lg:px-8 lg:pb-10 lg:pt-4">
          <div className="min-w-0">
          {data.recordingEmbedUrl ? (
            <div className="relative aspect-video w-full bg-black md:mt-4 md:overflow-hidden md:rounded-2xl lg:mt-0">
              <iframe
                src={data.recordingEmbedUrl}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                title={s.title}
              />
            </div>
          ) : (
            <div className="mx-4 mt-4 grid aspect-video place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 text-center text-white lg:mx-0 lg:mt-0">
              <div className="px-6">
                <Video className="mx-auto mb-2 h-10 w-10 opacity-80" />
                {data.recordingOnWebsiteOnly ? (
                  <>
                    <p className="font-bold">{lang === 'ar' ? 'التسجيل متاح على موقع إنجوسوفت' : 'The recording is ready on the Engosoft website'}</p>
                    <a className="btn mt-3 h-10 bg-white px-4 text-sm text-brand-700" href={data.websiteUrl} target="_blank" rel="noreferrer">{t('openOnWebsite')}</a>
                  </>
                ) : (
                  <>
                    <p className="font-bold">{s.status === 'ended' ? t('recordingSoon') : formatDay(s.start, lang)}</p>
                    {s.status !== 'ended' && <p className="num mt-1 text-white/80">{formatTime(s.start, lang)}</p>}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="space-y-5 px-4 py-4 lg:px-0 lg:py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold lg:text-[22px]">{s.title}</h2>
                <p className="text-sm text-muted">{formatDay(s.start, lang)} · <span className="num">{formatTime(s.start, lang)}</span></p>
              </div>
              <SessionPill status={s.status} />
            </div>

            {s.canJoin && (
              <button className={s.status === 'live' ? 'btn-live w-full lg:w-auto lg:px-8' : 'btn-primary w-full lg:w-auto lg:px-8'} onClick={() => join(s.id)} disabled={busy === s.id}>
                <Video className="h-5 w-5" />{t('joinNow')}
              </button>
            )}
          </div>
          </div>

          <div className="px-4 pb-6 lg:sticky lg:top-24 lg:px-0 lg:pb-0">
            <section>
              <h3 className="section-title mb-2">{t('files')}</h3>
              {data.documents.length === 0 ? (
                <div className="card"><EmptyState icon={<FileText className="h-6 w-6" />} title={t('noFiles')} /></div>
              ) : (
                <div className="card divide-y divide-line/70">
                  {data.documents.map((d) => {
                    const Icon = fileIcon(d.extension)
                    return (
                      <button key={d.id} className="flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => openFile(d.id)}>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-accent"><Icon className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold" dir="auto">{d.name}</span>
                          <span className="num block text-xs uppercase text-muted">{[d.extension, d.size].filter(Boolean).join(' · ')}</span>
                        </span>
                        <Download className="h-5 w-5 text-muted" />
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
