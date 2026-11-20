import { Suspense, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, BookOpen, ExternalLink, Home, MessagesSquare, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ensureHub, onHub } from '../lib/hub'
import { useI18n, type Key } from '../lib/i18n'
import { PageTransition, ScrollToTop, motion } from '../lib/motion'
import { setBadge, syncSubscription } from '../lib/push'
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
    <span className="num absolute -top-1.5 start-[55%] min-w-[18px] rounded-full bg-live px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-surface">
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
      onHub('roomRemoved', () => void queryClient.invalidateQueries({ queryKey: ['chats'] })),
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
  const { user } = useAuth()
  const { pathname } = useLocation()
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-e border-line bg-surface md:flex">
      <div className="px-6 pb-6 pt-7">
        <Logo className="h-9 w-auto" />
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {tabs.map(({ to, icon: Icon, label, badge }) => (
          <NavLink key={to} to={to} end={to === '/'} className="relative flex h-12 items-center gap-3 rounded-2xl px-4 font-bold">
            {active(to) && (
              <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-brand-50" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
            )}
            <Icon className={clsx('relative h-5 w-5 transition', active(to) ? 'text-accent' : 'text-muted')} strokeWidth={active(to) ? 2.4 : 2} />
            <span className={clsx('relative transition', active(to) ? 'text-accent' : 'text-muted hover:text-ink')}>{t(label)}</span>
            {badge && badges?.[badge] ? <span className="num relative ms-auto rounded-full bg-live px-2 text-xs leading-5 text-white">{badges[badge]}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className="mx-4 mt-8 overflow-hidden rounded-3xl bg-brand-900 text-white">
        <img src="/art/empty-courses.webp" alt="" className="h-24 w-full object-cover opacity-80" />
        <div className="p-4">
          <p className="font-display text-sm font-bold">{lang === 'ar' ? 'عايز تكمّل مسارك؟' : 'Grow your track'}</p>
          <p className="mt-1 text-xs text-white/70">{lang === 'ar' ? 'دبلومات وكورسات جديدة على موقع إنجوسوفت.' : 'New diplomas and courses on engosoft.com.'}</p>
          <a href="https://engosoft.com" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-200 hover:text-white">
            engosoft.com <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-line px-5 py-4">
        <Avatar partnerId={user?.partnerId} name={user?.name ?? ''} size={40} />
        <NavLink to="/profile" className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{user?.name}</p>
          <p className="text-xs text-muted">{user?.kind === 'student' ? t('roleStudent') : t('roleInstructor')}</p>
        </NavLink>
        <button className="rounded-full border border-line px-2.5 py-1 text-xs font-bold text-muted hover:text-ink" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
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
  const { t } = useI18n()
  const { data: badges } = useBadges()
  const location = useLocation()
  const fullScreen = /^\/(chats\/[^/]+|lessons\/|sessions\/|assessments\/)/.test(location.pathname)
  const routeKey = location.pathname.startsWith('/chats') ? 'chats' : location.pathname

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
        <nav className="fixed inset-x-0 bottom-0 z-40 bg-surface/92 pb-[var(--safe-bottom)] shadow-bar backdrop-blur-xl md:hidden">
          <div className="mx-auto flex h-[64px] max-w-lg items-stretch">
            {tabs.map(({ to, icon: Icon, label, badge }) => (
              <NavLink key={to} to={to} end={to === '/'}
                className={({ isActive }) => clsx('relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition', isActive ? 'text-accent' : 'text-muted')}>
                {({ isActive }) => (
                  <>
                    <span className="relative grid h-8 w-14 place-items-center">
                      {isActive && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-brand-50" transition={{ type: 'spring', stiffness: 460, damping: 34 }} />}
                      <Icon className="relative h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                      {badge && <Count n={badges?.[badge]} />}
                    </span>
                    <span>{t(label)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
