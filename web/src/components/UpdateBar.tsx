import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { applyUpdate, useUpdateReady } from '../lib/update'
import { useI18n } from '../lib/i18n'

/** A new version is downloaded and waiting: one tap switches to it. */
export function UpdateBar() {
  const ready = useUpdateReady()
  const { lang } = useI18n()
  const [busy, setBusy] = useState(false)
  if (!ready) return null
  const ar = lang === 'ar'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(8px+var(--safe-top))]" role="status">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lift">
        <RefreshCw className="h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{ar ? 'تحديث جديد جاهز' : 'Update ready'}</p>
          <p className="text-xs text-muted">{ar ? 'يُعاد فتح التطبيق على أحدث إصدار.' : 'The app reopens on the latest version.'}</p>
        </div>
        <button className="btn-primary h-9 shrink-0 px-4 text-sm" disabled={busy} onClick={() => { setBusy(true); void applyUpdate() }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ar ? 'تحديث' : 'Update'}
        </button>
      </div>
    </div>
  )
}
