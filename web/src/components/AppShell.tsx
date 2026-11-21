import { Suspense, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, BookOpen, ExternalLink, Home, MessagesSquare, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ensureHub, onHub } from '../lib/hub'
import { useI18n, type Key } from '../lib/i18n'
import { PageTransition, ScrollToTop, motion } from '../lib/motion'
import { setBadge, syncSubscription } from '../lib/push'
import { useTheme } from '../lib/theme'
import { Avatar, Logo, useToast } from './ui'

interface Badges { messages: number; notifications: number }

export function useBadges() {
  return useQuery({ queryKey: ['badges'], queryFn: () => api<Badges>('/api/badges'), refetchInterval: 60_000, staleTime: 10_000 })
}

const tabs: { to: string; icon: typeof Home; label: Key; badge?: keyof Badges }[] = [
  { to: '/', icon: Home, label: 'home' },
  { to: '/courses', icon: BookOpen, label: 'courses' },
  { to: '/chats', icon: MessagesSquare, label: 'chats', badge: 'messages' },
  { to: '/notifications', icon: Bell, label: 'notifications', badge: 'notifications' },
  { to: '/profile', icon: UserRound, label: 'profile' },
]

function Count({ n }: { n?: number }) {
  if (!n) return null
  return (
    <span className="num absolute -top-1.5 start-[60%] min-w-[18px] rounded-full bg-live px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-surface">
      {n > 99 ? '99+' : n}
    </span>
  )
}

/** Live updates from the server: refresh lists and badges, surface new notifications. */
function RealtimeBridge() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    void ensureHub().catch(() => undefined)
    void syncSubscription().catch(() => undefined)
    const offs = [
      onHub('roomActivity', () => {
        void queryClient.invalidateQueries({ queryKey: ['chats'] })
        void queryClient.invalidateQueries({ queryKey: ['badges'] })
      }),
      // Added to (or removed from) a course in Odoo: the group, the course and Home change together.
      onHub('roomAdded', () => {
        for (const key of ['chats', 'badges', 'live-courses', 'home', 'courses']) void queryClient.invalidateQueries({ queryKey: [key] })
      }),
      onHub('roomRemoved', () => {
        for (const key of ['chats', 'live-courses', 'home', 'courses']) void queryClient.invalidateQueries({ queryKey: [key] })
      }),
      onHub('notification', (n: { title: string; url?: string }) => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['badges'] })
        void queryClient.invalidateQueries({ queryKey: ['pending-assessments'] })
        if (document.visibilityState === 'visible')
          toast({ kind: 'info', text: n.title, action: n.url ? { label: '←', run: () => navigate(n.url!) } : undefined })
      }),
      onHub('reconnected', () => void queryClient.invalidateQueries()),
    ]
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void ensureHub().catch(() => undefined)
        void queryClient.invalidateQueries({ queryKey: ['badges'] })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { offs.forEach((o) => o()); document.removeEventListener('visibilitychange', onVisible) }
  }, [queryClient, toast, navigate])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string' && e.data.url !== location.pathname) navigate(e.data.url)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [navigate, location.pathname])

  return null
}

function SideNav({ badges }: { badges?: Badges }) {
  const { t, lang, setLang } = useI18n()
  const { resolved, setTheme } = useTheme()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  const tool = 'grid h-9 min-w-9 place-items-center rounded-[10px] px-2 text-[13px] font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink'
  return (
    <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-e border-line bg-surface md:flex">
      <div className="px-6 pb-8 pt-7">
        <Logo className="h-10 w-auto" />
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label={t('home')}>
        {tabs.map(({ to, icon: Icon, label, badge }) => {
          const on = active(to)
          return (
            <NavLink key={to} to={to} end={to === '/'}
              className={clsx('relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors', on ? 'text-accent' : 'text-muted hover:bg-sunken hover:text-ink')}>
              {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-brand-50" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
              {on && <span className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-accent" />}
              <Icon className="relative h-5 w-5" strokeWidth={on ? 2.2 : 1.9} />
              <span className="relative flex-1">{t(label)}</span>
              {badge && badges?.[badge] ? <span className="num relative min-w-[22px] rounded-full bg-live px-1.5 text-center text-xs font-bold leading-[22px] text-white">{badges[badge]}</span> : null}
            </NavLink>
          )
        })}
      </nav>

      {user?.kind === 'admin' && (
        <NavLink to="/admin"
          className={({ isActive }) => clsx('mx-3 mt-4 flex h-11 items-center gap-3 rounded-xl border px-3 text-[15px] font-semibold transition-colors',
            isActive ? 'border-brand-500 bg-brand-500 text-white' : 'border-line text-ink hover:bg-sunken')}>
          <ShieldCheck className="h-5 w-5" />{lang === 'ar' ? 'لوحة الإدارة' : 'Admin'}
        </NavLink>
      )}

      <a href="https://engosoft.com" target="_blank" rel="noreferrer"
        className="mx-3 mt-6 flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-[13px] text-muted transition-colors hover:bg-sunken hover:text-ink">
        <ExternalLink className="h-4 w-4 shrink-0" />
        <span className="flex-1 leading-5">{lang === 'ar' ? 'دبلومات ودورات جديدة على موقع إنجوسوفت' : 'New diplomas and courses on engosoft.com'}</span>
      </a>

      <div className="mt-auto border-t border-line px-4 pb-4 pt-3">
        <div className="mb-3 flex items-center justify-between">
          <button className={tool} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} aria-label={t('appearance')} title={t('appearance')}>
            {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <button className={tool} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
        </div>
        <NavLink to="/profile" className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-sunken">
          <Avatar partnerId={user?.partnerId} name={user?.name ?? ''} size={40} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[14px] font-semibold leading-5">{user?.name}</span>
            <span className="block text-xs text-muted">{user?.kind === 'student' ? t('roleStudent') : user?.kind === 'admin' ? t('roleAdmin') : t('roleInstructor')}</span>
          </span>
        </NavLink>
      </div>
    </aside>
  )
}

function ScreenLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 pt-6" aria-busy="true">
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton h-40" />
      <div className="skeleton h-24" />
    </div>
  )
}

export function AppShell() {
  const { t, lang } = useI18n()
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const { data: badges } = useBadges()
  const location = useLocation()
  const fullScreen = /^\/(chats\/[^/]+|lessons\/|sessions\/|assessments\/)/.test(location.pathname)
  const routeKey = location.pathname.startsWith('/chats') ? 'chats' : location.pathname
  const activeTab = tabs.findIndex(({ to }) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)))

  useEffect(() => { void setBadge((badges?.messages ?? 0) + (badges?.notifications ?? 0)) }, [badges])

  return (
    <div className="min-h-dvh md:flex">
      <RealtimeBridge />
      <ScrollToTop />
      <SideNav badges={badges} />

      <main className={clsx('min-w-0 flex-1', !fullScreen && 'pb-nav', location.pathname.startsWith('/chats') && 'md:!pb-0')}>
        <PageTransition routeKey={routeKey}>
          <Suspense fallback={<ScreenLoading />}>
            <Outlet />
          </Suspense>
        </PageTransition>
      </main>

      {!fullScreen && (
        <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(8px+var(--safe-bottom))] md:hidden">
          {/* Floats over the content on glass, inset from the edges, like the system tab bar */}
          <div className="pointer-events-auto mx-auto h-16 max-w-md rounded-[22px] border border-ink/[0.10] bg-surface/85 p-1.5 shadow-[0_8px_24px_rgb(var(--shadow)/0.16)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.08] dark:shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
            <div className="relative flex h-full items-stretch gap-1">
              {/* One indicator that slides inside the bar. A shared-layout animation measured against the page
                  and flew outside the bar when the new screen scrolled back to the top. */}
              <span aria-hidden
                className={clsx('absolute inset-y-0 start-0 rounded-[16px] bg-brand-500/[0.12] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:bg-brand-300/[0.16]', activeTab < 0 && 'opacity-0')}
                style={{ width: 'calc((100% - 16px) / 5)', transform: `translateX(calc(${dir === 'rtl' ? -1 : 1} * ${Math.max(activeTab, 0)} * (100% + 4px)))` }} />
              {tabs.map(({ to, icon: Icon, label, badge }) => (
                <NavLink key={to} to={to} end={to === '/'}
                  className={({ isActive }) => clsx('relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[16px] text-[11px] transition-colors', isActive ? 'font-bold text-accent' : 'font-medium text-muted active:text-ink')}>
                  {({ isActive }) => (
                    <>
                      <span className="relative">
                        <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.75} />
                        {badge && <Count n={badges?.[badge]} />}
                      </span>
                      <span className="relative leading-none">{t(label)}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
      )}
    </div>
  )
}
