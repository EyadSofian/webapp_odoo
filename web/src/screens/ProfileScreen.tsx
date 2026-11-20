import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, BellRing, ChevronLeft, Globe, LogOut, Moon, Palette, Send, ShoppingBag, Smartphone } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { enablePush, disablePush, pushState, type PushState } from '../lib/push'
import { useInstallPrompt } from '../lib/install'
import { useTheme, type ThemeChoice } from '../lib/theme'
import type { Preferences, Profile } from '../lib/types'
import { Avatar, Skeleton, TopBar, useToast } from '../components/ui'

const minutesToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const timeToMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }

export function ProfileScreen() {
  const { t, lang, setLang } = useI18n()
  const { user, signOut } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const install = useInstallPrompt()
  const profile = useQuery({ queryKey: ['me'], queryFn: () => api<Profile>('/api/me') })
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api<Preferences>('/api/preferences') })
  const [push, setPush] = useState<PushState>(pushState)
  const { theme, setTheme } = useTheme()

  const savePrefs = useMutation({
    mutationFn: (p: Preferences) => api('/api/preferences', { method: 'PUT', json: p }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prefs'] }),
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  const togglePush = async () => {
    if (push === 'granted') { await disablePush(); setPush('default'); return }
    const next = await enablePush().catch(() => 'default' as PushState)
    setPush(next)
    if (next === 'denied') toast({ kind: 'error', text: t('pushBlocked') })
    if (next === 'needs-install') toast({ kind: 'info', text: t('installWhy') })
  }

  const p = prefs.data
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div className="mx-auto max-w-3xl md:px-4">
      <TopBar title={t('profile')} />
      <div className="space-y-5 px-4 py-4">
        <div className="card flex items-center gap-4 p-4">
          <Avatar partnerId={user?.partnerId} name={user?.name ?? ''} size={60} />
          <div className="min-w-0 flex-1">
            {profile.isLoading ? <Skeleton className="h-5 w-40" /> : (
              <>
                <p className="truncate font-display text-lg font-bold">{profile.data?.name}</p>
                {profile.data?.nameAr && profile.data.nameAr !== profile.data.name && <p className="truncate text-sm text-muted">{profile.data.nameAr}</p>}
                <p className="truncate text-sm text-muted" dir="ltr">{profile.data?.email}</p>
              </>
            )}
          </div>
        </div>

        <Link to="/certificates" className="card flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold/15 text-[#B7791F]"><Award className="h-5 w-5" /></span>
          <span className="flex-1 font-bold">{t('certificates')}</span>
          <ChevronLeft className="h-5 w-5 text-muted ltr:rotate-180" />
        </Link>

        <section className="card divide-y divide-line/70">
          <h2 className="px-4 pb-2 pt-4 text-sm font-bold text-muted">{t('notificationsSettings')}</h2>
          <div className="flex items-center gap-3 px-4 py-3">
            <BellRing className="h-5 w-5 text-accent" />
            <div className="flex-1">
              <p className="font-bold">{push === 'granted' ? t('pushOn') : push === 'denied' ? t('pushBlocked') : t('pushOff')}</p>
              <p className="text-xs text-muted">{push === 'needs-install' ? t('installWhy') : t('pushWhy')}</p>
            </div>
            {push !== 'unsupported' && push !== 'denied' && (
              <button className={push === 'granted' ? 'btn-soft h-9 px-3 text-sm' : 'btn-primary h-9 px-3 text-sm'} onClick={togglePush}>
                {push === 'granted' ? t('off') : t('enablePush')}
              </button>
            )}
          </div>
          {push === 'granted' && (
            <button className="flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => api('/api/push/test', { method: 'POST' }).then(() => toast({ kind: 'ok', text: '✓' }))}>
              <Send className="h-5 w-5 text-muted" /><span className="flex-1">{t('testPush')}</span>
            </button>
          )}
          {p && (
            <div className="px-4 py-3">
              <label className="flex items-center gap-3">
                <Moon className="h-5 w-5 text-muted" />
                <span className="flex-1"><span className="block font-bold">{t('quietHours')}</span><span className="block text-xs text-muted">{t('quietHoursHint')}</span></span>
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand-500))]" checked={p.quietHoursEnabled}
                  onChange={(e) => savePrefs.mutate({ ...p, quietHoursEnabled: e.target.checked, timeZone: tz })} />
              </label>
              {p.quietHoursEnabled && (
                <div className="mt-3 flex items-center gap-2 ps-8 text-sm" dir="ltr">
                  <input type="time" className="field h-10 w-auto" value={minutesToTime(p.quietFromMinute)} onChange={(e) => savePrefs.mutate({ ...p, quietFromMinute: timeToMinutes(e.target.value), timeZone: tz })} />
                  <span>→</span>
                  <input type="time" className="field h-10 w-auto" value={minutesToTime(p.quietToMinute)} onChange={(e) => savePrefs.mutate({ ...p, quietToMinute: timeToMinutes(e.target.value), timeZone: tz })} />
                </div>
              )}
            </div>
          )}
          {install.canPrompt && (
            <button className="flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => install.prompt()}>
              <Smartphone className="h-5 w-5 text-accent" /><span className="flex-1 font-bold">{t('installApp')}</span>
            </button>
          )}
        </section>

        <section className="card divide-y divide-line/70">
          <h2 className="px-4 pb-2 pt-4 text-sm font-bold text-muted">{t('settings')}</h2>
          <div className="flex items-center gap-3 px-4 py-3">
            <Globe className="h-5 w-5 text-muted" />
            <span className="flex-1">{t('language')}</span>
            <div className="flex rounded-lg bg-sunken p-0.5 text-sm font-bold">
              <button className={lang === 'ar' ? 'rounded-md bg-surface px-3 py-1 shadow-card' : 'px-3 py-1 text-muted'} onClick={() => setLang('ar')}>العربية</button>
              <button className={lang === 'en' ? 'rounded-md bg-surface px-3 py-1 shadow-card' : 'px-3 py-1 text-muted'} onClick={() => setLang('en')}>English</button>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Palette className="h-5 w-5 text-muted" />
            <span className="flex-1">{t('appearance')}</span>
            <div className="flex rounded-lg bg-sunken p-0.5 text-sm font-bold" role="radiogroup" aria-label={t('appearance')}>
              {(['light', 'dark', 'system'] as ThemeChoice[]).map((c) => (
                <button key={c} role="radio" aria-checked={theme === c} onClick={() => setTheme(c)}
                  className={theme === c ? 'rounded-md bg-surface px-3 py-1 shadow-card' : 'px-3 py-1 text-muted'}>
                  {t(c === 'light' ? 'themeLight' : c === 'dark' ? 'themeDark' : 'themeSystem')}
                </button>
              ))}
            </div>
          </div>
          <a href={profile.data?.websiteUrl ?? 'https://engosoft.com'} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3">
            <ShoppingBag className="h-5 w-5 text-muted" /><span className="flex-1">{t('browseMore')}</span><span className="text-xs text-muted">engosoft.com</span>
          </a>
          <button className="flex w-full items-center gap-3 px-4 py-3 text-start text-live" onClick={() => signOut()}>
            <LogOut className="h-5 w-5 ltr:rotate-180" /><span className="flex-1 font-bold">{t('logout')}</span>
          </button>
        </section>

        <p className="pb-4 text-center text-xs text-muted">Engosoft Learn · v1.0</p>
      </div>
    </div>
  )
}
