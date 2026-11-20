import type { Lang } from './i18n'

const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')

export function formatTime(iso: string | null | undefined, lang: Lang) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(loc(lang), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function formatDay(iso: string | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(loc(lang), opts).format(new Date(iso))
}

export function formatDate(iso: string | null | undefined, lang: Lang) {
  return formatDay(iso, lang, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function relativeDay(iso: string, lang: Lang) {
  const d = new Date(iso)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(d) - start(today)) / 86_400_000)
  const rtf = new Intl.RelativeTimeFormat(loc(lang), { numeric: 'auto' })
  if (Math.abs(diff) <= 1) return rtf.format(diff, 'day')
  return formatDay(iso, lang)
}

/** "2 س 15 د" / "2h 15m" until a date; null when it has passed. */
export function countdown(iso: string | null, lang: Lang, now = Date.now()) {
  if (!iso) return null
  let ms = new Date(iso).getTime() - now
  if (ms <= 0) return null
  const days = Math.floor(ms / 86_400_000); ms -= days * 86_400_000
  const hours = Math.floor(ms / 3_600_000); ms -= hours * 3_600_000
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (lang === 'ar') {
    if (days > 0) return `${days} ي ${hours} س`
    if (hours > 0) return `${hours} س ${minutes} د`
    return `${minutes} دقيقة`
  }
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} min`
}

export function chatTime(iso: string, lang: Lang) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return formatTime(iso, lang)
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 6) return new Intl.DateTimeFormat(loc(lang), { weekday: 'short' }).format(d)
  return new Intl.DateTimeFormat(loc(lang), { day: 'numeric', month: 'numeric' }).format(d)
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string) {
  const parts = name.replace(/^(eng\.|م\.|د\.)\s*/i, '').trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
}

const WEEKDAYS_AR: Record<string, string> = {
  saturday: 'السبت', sunday: 'الأحد', monday: 'الاتنين', tuesday: 'التلات', wednesday: 'الأربع', thursday: 'الخميس', friday: 'الجمعة',
}
export function weekday(name: string, lang: Lang) {
  return lang === 'ar' ? WEEKDAYS_AR[name] ?? name : name[0].toUpperCase() + name.slice(1)
}
