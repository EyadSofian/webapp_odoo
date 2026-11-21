import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertCircle, ArrowRight, CheckCircle2, Info, RefreshCw, X } from 'lucide-react'
import { ApiError, fetchBlobUrl } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { initials } from '../lib/format'
import type { MemberRole, SessionStatus } from '../lib/types'

// ------------------------------------------------------------------ brand

/** The original Engosoft logo files from engosoft.com, used as-is. */
/**
 * The Engosoft wordmark only (no tagline). `color` follows the theme: brand colors on light, white on dark.
 * `white` is for photos and dark panels.
 */
export function Logo({ variant = 'color', className }: { variant?: 'color' | 'white' | 'mark'; className?: string }) {
  const white = '/brand/engosoft-wordmark-white.png'
  if (variant === 'white') return <img src={white} alt="Engosoft" className={clsx('select-none', className)} draggable={false} />
  if (variant === 'mark') return <img src="/brand/engosoft-mark.png" alt="Engosoft" className={clsx('select-none', className)} draggable={false} />
  return (
    <>
      <img src="/brand/engosoft-wordmark.png" alt="Engosoft" className={clsx('select-none dark:hidden', className)} draggable={false} />
      <img src={white} alt="Engosoft" className={clsx('hidden select-none dark:block', className)} draggable={false} />
    </>
  )
}

// ------------------------------------------------------------------ authed media

export function useAuthedImage(path: string | null) {
  return useQuery({
    queryKey: ['blob', path],
    queryFn: () => fetchBlobUrl(path!),
    enabled: !!path,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  }).data
}

const AVATAR_TONES = [
  'bg-brand-100 text-accent', 'bg-[#E6F4EA] text-[#1E6B3A]', 'bg-[#FDF0DC] text-[#8A5A0B]',
  'bg-[#F3E8FD] text-[#6B3FA0]', 'bg-[#E3F2F7] text-[#1C6A80]', 'bg-[#FDE8E8] text-[#A33A3A]',
]

export function Avatar({ partnerId, name, size = 40, ring }: { partnerId?: number; name: string; size?: number; ring?: boolean }) {
  const url = useAuthedImage(partnerId ? `/api/media/partners/${partnerId}/avatar` : null)
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span
      className={clsx('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold', tone, ring && 'ring-2 ring-surface')}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  )
}

const COVERS: [RegExp, string][] = [
  [/electric|light current|power|كهرب/i, 'cover-electrical'],
  [/hvac|mep|plumb|fire|mechanic|ميكان|تكييف/i, 'cover-mep'],
  [/revit|bim|autocad|architect|interior|sketch|3ds|lumion|design|معمار|ديكور/i, 'cover-architecture'],
  [/pmp|primavera|planning|project|management|cfm|cmrp|إدارة|تخطيط/i, 'cover-management'],
]

/** A photo that fits the subject when Odoo has no artwork for the course. */
export function fallbackCover(title: string) {
  const hit = COVERS.find(([re]) => re.test(title))
  return `/art/${hit ? hit[1] : 'cover-site'}.webp`
}

/** Course art from Odoo (course or product image); otherwise a subject photo. */
export function CourseCover({ channelId, eventId, title, className, rounded = 'rounded-2xl', children }: { channelId?: number | null; eventId?: number | null; title: string; className?: string; rounded?: string; children?: ReactNode }) {
  const path = eventId ? `/api/media/events/${eventId}/image` : channelId ? `/api/media/courses/${channelId}/image` : null
  const q = useQuery({ queryKey: ['blob', path], queryFn: () => fetchBlobUrl(path!), enabled: !!path, staleTime: 3600_000, gcTime: 7200_000, retry: false })
  const src = q.data ?? (q.isLoading && path ? null : fallbackCover(title))
  return (
    <div className={clsx('relative overflow-hidden bg-brand-700', rounded, className)}>
      {src
        ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" loading="lazy" />
        : <div className="skeleton absolute inset-0 rounded-none" />}
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ progress & status

export function ProgressRing({ value, size = 44, stroke = 4, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" className="stroke-sunken" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" strokeLinecap="round"
          className={clsx('transition-all duration-700', v >= 100 ? 'stroke-ok' : 'stroke-brand-500')}
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} />
      </svg>
      <span className="absolute num text-[11px] font-bold">{children ?? `${Math.round(v)}%`}</span>
    </span>
  )
}

/** A small amount still reads as a bar (not a dot): the fill never goes below a short stub. */
export function ProgressBar({ value, className, tone = 'blue' }: { value: number; className?: string; tone?: 'blue' | 'sky' }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-[width] duration-700', v >= 100 ? 'bg-ok' : tone === 'sky' ? 'bg-sky' : 'bg-brand-500')}
        style={{ width: v > 0 ? `max(${v}%, 14px)` : 0 }} />
    </div>
  )
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={clsx('relative inline-flex h-2.5 w-2.5', className)}>
      <span className="absolute inline-flex h-full w-full animate-live-ping rounded-full bg-live" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
    </span>
  )
}

export function SessionPill({ status }: { status: SessionStatus }) {
  const { t } = useI18n()
  if (status === 'live') return <span className="chip bg-live/10 text-live"><LiveDot className="scale-75" />{t('liveNow')}</span>
  if (status === 'ended') return <span className="chip bg-sunken text-muted">{t('ended')}</span>
  if (status === 'cancelled') return <span className="chip bg-warn/10 text-warn">{t('cancelled')}</span>
  return <span className="chip bg-brand-50 text-accent">{t('upcomingShort')}</span>
}

export function RoleBadge({ role }: { role: MemberRole }) {
  const { t } = useI18n()
  if (role === 'student') return null
  const label = role === 'instructor' ? t('roleInstructor') : role === 'assistant' ? t('roleAssistant') : role === 'coordinator' ? t('roleCoordinator') : t('roleAdmin')
  return <span className={clsx('chip h-5 px-2 text-[11px]', role === 'instructor' ? 'bg-brand-500 text-white' : 'bg-gold/15 text-[#8A5A0B] dark:text-gold')}>{label}</span>
}

// ------------------------------------------------------------------ layout bits

export function TopBar({ title, subtitle, back, actions, transparent }: { title?: ReactNode; subtitle?: ReactNode; back?: boolean | string; actions?: ReactNode; transparent?: boolean }) {
  const navigate = useNavigate()
  const { t } = useI18n()
  return (
    <header className={clsx('sticky top-0 z-30 pt-safe', transparent ? 'bg-transparent' : 'border-b border-line/70 bg-surface/85 backdrop-blur-xl md:bg-bg/80')}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 md:h-20 md:px-8">
        {back && (
          <button
            className="back-btn grid h-10 w-10 place-items-center rounded-full hover:bg-sunken"
            onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/'))}
            aria-label={t('back')}
          >
            <ArrowRight className="h-5 w-5 ltr:rotate-180" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {title && <h1 dir={typeof title === 'string' ? 'auto' : undefined} className="bidi truncate font-display text-[17px] font-bold leading-tight md:text-[26px]">{title}</h1>}
          {subtitle && <p className="truncate text-xs text-muted md:mt-1 md:text-sm">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </header>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-sunken p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('h-9 flex-1 rounded-lg text-sm font-bold transition', value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function EmptyState({ icon, title, body, action, image }: { icon: ReactNode; title: string; body?: string; action?: ReactNode; image?: string }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center animate-fade-up">
      {image
        ? <img src={image} alt="" className="mb-6 aspect-[16/10] w-full max-w-sm rounded-3xl object-cover shadow-lift" loading="lazy" />
        : <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-accent">{icon}</div>}
      <h3 className="font-display text-base font-bold">{title}</h3>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n()
  const message = error instanceof ApiError ? error.message : t('offline')
  return (
    <div className="mx-4 my-6 flex flex-col items-center rounded-2xl border border-line bg-surface px-6 py-8 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-warn" />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <button className="btn-soft mt-4 h-10" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />{t('retry')}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ sheet

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal>
      <button className="absolute inset-0 bg-[rgb(6_32_58/0.45)] backdrop-blur-[2px]" onClick={onClose} aria-label={t('close')} />
      <div className="relative max-h-[85vh] w-full max-w-lg animate-sheet-in overflow-y-auto rounded-t-3xl bg-surface pb-[calc(16px+var(--safe-bottom))] shadow-lift md:rounded-3xl md:pb-4">
        <div className="sticky top-0 z-10 bg-surface/95 px-5 pb-2 pt-3 backdrop-blur">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line md:hidden" />
          {title && (
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold">{title}</h2>
              <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-sunken" onClick={onClose} aria-label={t('close')}><X className="h-5 w-5" /></button>
            </div>
          )}
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setToasts((all) => [...all.slice(-2), { ...t, id }])
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 9000 : 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-[calc(12px+var(--safe-top))] z-[60] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex w-full max-w-md animate-fade-up items-center gap-3 rounded-2xl bg-[rgb(6_32_58)] px-4 py-3 text-sm text-white shadow-lift" role="status">
              {t.kind === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[#5BD08A]" /> : t.kind === 'error' ? <AlertCircle className="h-5 w-5 shrink-0 text-[#FF8A8A]" /> : <Info className="h-5 w-5 shrink-0 text-brand-200" />}
              <span className="flex-1">{t.text}</span>
              {t.action && <button className="font-bold text-brand-200" onClick={t.action.run}>{t.action.label}</button>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
