import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Mail, MessagesSquare, Moon, PlayCircle, Radio, ShieldCheck, Sun } from 'lucide-react'
import { ApiError, devLoginAs, login } from '../lib/api'
import { useI18n, type Key } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { AnimatePresence, motion } from '../lib/motion'
import { useReducedMotion } from 'framer-motion'
import { Logo } from '../components/ui'

const WEBSITE = 'https://engosoft.com'
const TRACKS: Key[] = ['trackElectrical', 'trackArchitecture', 'trackMep', 'trackSite', 'trackManagement']
const ease = [0.2, 0.8, 0.2, 1] as const

/** One stroke that draws itself (CSS only; reduced motion shows it at once). */
function Stroke({ d, delay, dashed }: { d: string; delay: number; dashed?: boolean }) {
  return dashed
    ? <path d={d} strokeDasharray="3 4" className="animate-fade-up" style={{ animationDelay: `${delay}s` }} />
    : <path d={d} pathLength={1} className="bp-draw" style={{ animationDelay: `${delay}s` }} />
}

/** Blueprint lines that draw themselves over the photo: the engineering feel without another stock image. */
function Blueprint() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/25" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="bp-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35" />
        </pattern>
      </defs>
      <rect width="400" height="600" fill="url(#bp-grid)" opacity="0.5" />
      <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <Stroke d="M20 470 H380" delay={0.1} />
        <Stroke d="M40 470 L40 250 L150 170 L260 250 L260 470 Z" delay={0.3} />
        <Stroke d="M80 470 L80 330 L130 330 L130 470" delay={0.9} />
        <Stroke d="M170 290 h55 v45 h-55 Z" delay={1.2} />
        <Stroke d="M300 470 V140 M300 140 H372 M300 140 L360 92 M372 140 V190" delay={1.5} />
        <Stroke d="M128 120 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0" delay={1.8} />
        <Stroke d="M40 500 H260 M40 494 V506 M260 494 V506" delay={2.1} dashed />
      </g>
    </svg>
  )
}

function RotatingTrack() {
  const { t } = useI18n()
  const [i, setI] = useState(0)
  const r = useReducedMotion()
  useEffect(() => {
    if (r) return
    const id = setInterval(() => setI((n) => (n + 1) % TRACKS.length), 2600)
    return () => clearInterval(id)
  }, [r])
  return (
    <span className="relative inline-grid h-[1.5em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={i} className="whitespace-nowrap bg-gradient-to-l from-brand-200 to-white bg-clip-text text-transparent"
          initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-100%', opacity: 0 }} transition={{ duration: 0.5, ease }}>
          {t(TRACKS[i])}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function Feature({ icon: Icon, label, delay, className }: { icon: typeof Radio; label: string; delay: number; className?: string }) {
  const r = useReducedMotion()
  return (
    <motion.div
      className={`flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-[13px] font-bold text-white shadow-[0_8px_30px_-10px_rgb(0_0_0/0.5)] backdrop-blur-md ${className ?? ''}`}
      initial={r ? false : { opacity: 0, y: 14, scale: 0.96 }}
      animate={r ? undefined : { opacity: 1, y: [0, -5, 0], scale: 1 }}
      transition={{ opacity: { delay, duration: 0.5 }, scale: { delay, duration: 0.5 }, y: { delay: delay + 0.5, duration: 5, repeat: Infinity, ease: 'easeInOut' } }}
    >
      <span className="grid h-7 w-7 place-items-center rounded-xl bg-white/15"><Icon className="h-4 w-4" /></span>
      {label}
    </motion.div>
  )
}

export function LoginScreen() {
  const { t, lang, setLang } = useI18n()
  const { resolved, setTheme } = useTheme()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devPartner, setDevPartner] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('offline'))
    } finally {
      setBusy(false)
    }
  }

  const pill = 'grid h-9 place-items-center rounded-full border border-white/25 bg-white/10 px-3 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/20'

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg md:flex-row">

      {/* Visual side */}
      <div className="relative h-[44vh] min-h-[320px] overflow-hidden bg-brand-900 md:sticky md:top-0 md:h-dvh md:flex-1">
        <motion.img
          src="/art/cover-site.webp" alt=""
          className="absolute inset-0 h-full w-full object-cover object-[60%_50%]"
          initial={reduce ? false : { scale: 1.15 }}
          animate={reduce ? undefined : { scale: [1.15, 1.04, 1.1], x: ['0%', '-2%', '1%'] }}
          transition={{ duration: 24, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgb(6_32_58/0.55)] via-[rgb(6_32_58/0.45)] to-[rgb(6_32_58/0.96)] md:bg-gradient-to-l md:from-[rgb(6_32_58/0.35)] md:via-[rgb(6_32_58/0.7)] md:to-[rgb(6_32_58/0.95)]" />
        <motion.div aria-hidden className="absolute -top-24 end-[-20%] h-80 w-80 rounded-full bg-brand-400/30 blur-3xl"
          animate={reduce ? undefined : { scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
        <Blueprint />

        <div className="relative flex h-full flex-col p-5 pt-[calc(18px+var(--safe-top))] md:p-12">
          <div className="flex items-center justify-between gap-3">
            <Logo variant="white" className="h-9 w-auto md:h-11" />
            <div className="flex items-center gap-2">
              <button className={pill} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} aria-label={t('appearance')}>
                {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button className={pill} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'EN' : 'ع'}</button>
            </div>
          </div>

          <div className="mt-auto pb-10 text-white md:pb-4">
            <motion.p className="font-display text-[19px] font-bold leading-[1.55] md:max-w-xl md:text-[42px] md:leading-[1.35]"
              initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7, ease }}>
              {t('loginHeadline')}
            </motion.p>
            <motion.p className="mt-3 text-[15px] text-white/80 md:mt-5 md:text-xl"
              initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6, ease }}>
              {t('loginTrack')} <RotatingTrack />
            </motion.p>
            <p className="mt-3 hidden max-w-lg text-white/65 md:block">{t('loginSub')}</p>
            <div className="mt-8 hidden flex-wrap gap-3 md:flex">
              <Feature icon={Radio} label={t('featLive')} delay={0.7} />
              <Feature icon={PlayCircle} label={t('featRecordings')} delay={0.85} className="md:translate-y-3" />
              <Feature icon={MessagesSquare} label={t('featGroups')} delay={1} />
            </div>
          </div>
        </div>
      </div>

      {/* Form side */}
      <div className="relative z-10 -mt-8 flex flex-1 justify-center px-4 pb-[calc(24px+var(--safe-bottom))] md:mt-0 md:max-w-[560px] md:items-center md:px-12">
        <motion.div
          className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-line/80 bg-surface/95 p-6 shadow-[0_24px_60px_-24px_rgb(var(--shadow)/0.45)] backdrop-blur-xl md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0"
          initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6, ease }}>
          {/* Brand accent line across the top of the card on phones */}
          <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-brand-300 via-brand-500 to-brand-800 md:hidden" />

          <form onSubmit={submit}>
            <h1 className="font-display text-[26px] font-bold leading-snug md:text-[32px]">{t('welcomeBack')}</h1>
            <p className="mb-7 mt-1.5 text-[15px] leading-7 text-muted">{t('signInHint')}</p>

            <label className="mb-1.5 block text-sm font-bold" htmlFor="email">{t('email')}</label>
            <div className="group relative mb-5">
              <Mail className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted transition group-focus-within:text-accent" />
              <input id="email" className="field ps-11" type="email" inputMode="email" autoComplete="username" dir="ltr" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </div>

            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-bold" htmlFor="password">{t('password')}</label>
              <a className="text-sm font-bold text-accent hover:underline" href={`${WEBSITE}/web/reset_password`} target="_blank" rel="noreferrer">{t('forgot')}</a>
            </div>
            <div className="group relative mb-6">
              <Lock className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted transition group-focus-within:text-accent" />
              <input id="password" className="field pe-12 ps-11" type={show ? 'text' : 'password'} autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="absolute inset-y-0 end-1 grid w-10 place-items-center text-muted hover:text-ink" onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mb-4 overflow-hidden rounded-xl bg-live/10 px-4 py-3 text-sm font-bold text-live" role="alert">{error}</motion.p>
              )}
            </AnimatePresence>

            <button className="btn-primary group relative h-[52px] w-full overflow-hidden bg-gradient-to-l from-brand-500 to-brand-700 text-base shadow-[0_12px_30px_-12px_rgb(22_86_160/0.8)]" disabled={busy}>
              {!reduce && <span aria-hidden className="absolute inset-y-0 -left-1/3 w-1/3 animate-[shine_3.2s_ease-in-out_infinite] bg-gradient-to-l from-transparent via-white/25 to-transparent" />}
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              <span className="relative">{busy ? t('signingIn') : t('signIn')}</span>
              {!busy && <ArrowLeft className="relative h-5 w-5 transition group-hover:-translate-x-1 ltr:rotate-180 ltr:group-hover:translate-x-1" />}
            </button>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" /> {t('secureNote')}
            </p>

            <div className="mt-6 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-line" />{t('notMember')}<span className="h-px flex-1 bg-line" />
            </div>
            <a className="btn-soft mt-4 h-11 w-full" href={WEBSITE} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>

            {import.meta.env.DEV && (
              <div className="mt-8 rounded-xl border border-dashed border-line p-3 text-xs text-muted">
                <p className="mb-2 font-bold">Dev only: sign in as an Odoo partner</p>
                <div className="flex gap-2">
                  <input className="field h-10 text-sm" dir="ltr" placeholder="partner id" value={devPartner} onChange={(e) => setDevPartner(e.target.value)} />
                  <button type="button" className="btn-soft h-10" onClick={async () => {
                    try { await devLoginAs(Number(devPartner)); navigate('/', { replace: true }) } catch (err) { setError(err instanceof ApiError ? err.message : String(err)) }
                  }}>Go</button>
                </div>
              </div>
            )}
          </form>
        </motion.div>
      </div>
    </div>
  )
}
