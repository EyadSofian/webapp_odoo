import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { applyUpdate, takeJustUpdated, useUpdateReady } from '../lib/update'
import { useI18n } from '../lib/i18n'

// Read once at startup, before any screen renders, so StrictMode's double render cannot lose it.
const justUpdated = takeJustUpdated()

/**
 * A new version is downloaded and waiting: one tap switches to it.
 * Right after a switch (from this bar, or silently at launch) a short notice confirms it.
 */
export function UpdateBar() {
  const ready = useUpdateReady()
  const { lang } = useI18n()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(justUpdated)
  const ar = lang === 'ar'

  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => setDone(false), 4500)
    return () => window.clearTimeout(id)
  }, [done])

  if (!ready && !done) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(8px+var(--safe-top))]" role="status">
      <div className="pointer-events-auto mx-auto flex max-w-md animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lift">
        {ready ? (
          <>
            <RefreshCw className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{ar ? 'تحديث جديد جاهز' : 'Update ready'}</p>
              <p className="text-xs text-muted">{ar ? 'يُعاد فتح التطبيق على أحدث إصدار.' : 'The app reopens on the latest version.'}</p>
            </div>
            <button className="btn-primary h-9 shrink-0 px-4 text-sm" disabled={busy} onClick={() => { setBusy(true); void applyUpdate() }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ar ? 'تحديث' : 'Update'}
            </button>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{ar ? 'تم تحديث التطبيق' : 'App updated'}</p>
              <p className="text-xs text-muted">{ar ? 'تعمل الآن على أحدث إصدار.' : 'You are on the latest version.'}</p>
            </div>
            <button className="h-9 shrink-0 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-sunken" onClick={() => setDone(false)}>
              {ar ? 'حسنًا' : 'OK'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
