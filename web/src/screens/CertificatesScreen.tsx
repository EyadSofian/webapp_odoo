import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, Download } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/format'
import type { Certificate } from '../lib/types'
import { EmptyState, ErrorState, Sheet, Skeleton, TopBar, useAuthedImage } from '../components/ui'

export function CertificatesScreen() {
  const { t, lang } = useI18n()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['certificates'], queryFn: () => api<Certificate[]>('/api/certificates') })
  const [open, setOpen] = useState<Certificate | null>(null)

  return (
    <div className="mx-auto max-w-3xl md:px-4">
      <TopBar back title={t('certificates')} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="grid grid-cols-2 gap-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3]" />)}</div>}
      {data && data.length === 0 && <EmptyState icon={<Award className="h-7 w-7" />} title={t('noCertificates')} />}
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {data?.map((c) => (
          <button key={c.id} className="card overflow-hidden text-start transition active:scale-[0.99]" onClick={() => setOpen(c)}>
            <CertThumb id={c.id} />
            <div className="p-3">
              <p className="line-clamp-2 font-bold">{c.title}</p>
              <p className="mt-1 text-xs text-muted">
                {c.type === 'attendance' ? (lang === 'ar' ? 'شهادة حضور' : 'Attendance') : (lang === 'ar' ? 'كورس مسجّل' : 'Recorded course')}
                {c.issuedAt && <> · <span className="num">{formatDate(c.issuedAt, lang)}</span></>}
              </p>
            </div>
          </button>
        ))}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open && <CertFull c={open} />}
      </Sheet>
    </div>
  )
}

function CertThumb({ id }: { id: number }) {
  const url = useAuthedImage(`/api/certificates/${id}/image`)
  return (
    <div className="relative aspect-[4/3] bg-gradient-to-br from-brand-50 to-sunken">
      {url ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain p-2" /> : <Award className="absolute inset-0 m-auto h-10 w-10 text-gold" />}
    </div>
  )
}

function CertFull({ c }: { c: Certificate }) {
  const { t, lang } = useI18n()
  const url = useAuthedImage(`/api/certificates/${c.id}/image`)
  return (
    <div className="space-y-4 pb-3">
      {url ? <img src={url} alt={c.title} className="w-full rounded-xl border border-line" /> : <Skeleton className="aspect-[4/3] w-full" />}
      <div className="flex items-center justify-between text-sm text-muted">
        <span className="num" dir="ltr">{c.number}</span>
        {c.issuedAt && <span className="num">{formatDate(c.issuedAt, lang)}</span>}
      </div>
      {url && <a className="btn-primary w-full" href={url} download={`engosoft-certificate-${c.number ?? c.id}.png`}><Download className="h-5 w-5" />{t('download')}</a>}
    </div>
  )
}
