import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { ApiError, devLoginAs, login } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { AnimatePresence, motion } from '../lib/motion'
import { Logo } from '../components/ui'
import { Majed } from '../components/Majed'

const WEBSITE = 'https://engosoft.com'
const ease = [0.22, 1, 0.36, 1] as const

/** A drawing dimension line: the one engineering detail on the page. */
function DimensionLine({ label }: { label: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 text-muted" aria-hidden>
      <span className="h-3 w-px bg-current" />
      <span className="h-px flex-1 bg-current" />
      <span className="text-[12px]">{label}</span>
      <span className="h-px flex-1 bg-current" />
      <span className="h-3 w-px bg-current" />
    </div>
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

  const chip = 'grid h-9 min-w-9 place-items-center rounded-[10px] border border-line bg-surface/70 px-2.5 text-[13px] font-medium text-ink backdrop-blur-md transition-colors hover:bg-surface'

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg text-ink">
      {/* A bright desk of drawings, helmet and coffee. A wash in the page color keeps text readable in both themes. */}
      <img src="/art/empty-courses.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[22%_50%] md:object-center" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--bg)/0.92)_0%,rgb(var(--bg)/0.55)_45%,rgb(var(--bg)/0.25)_100%)] md:bg-[linear-gradient(90deg,rgb(var(--bg)/0.94)_0%,rgb(var(--bg)/0.6)_50%,rgb(var(--bg)/0.15)_100%)] md:ltr:bg-[linear-gradient(270deg,rgb(var(--bg)/0.94)_0%,rgb(var(--bg)/0.6)_50%,rgb(var(--bg)/0.15)_100%)]" />

      <div className="relative mx-auto flex min-h-dvh max-w-[1280px] flex-col px-5 pb-[calc(20px+var(--safe-bottom))] pt-[calc(16px+var(--safe-top))] md:px-12 md:py-10">
        <header className="flex items-center justify-between">
          <Logo className="h-9 w-auto md:h-10" />
          <div className="flex items-center gap-2">
            <button className={chip} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} aria-label={t('appearance')}>
              {resolved === 'dark' ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
            </button>
            <button className={chip} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
          </div>
        </header>

        <div className="flex flex-1 flex-col md:grid md:grid-cols-[420px_minmax(0,1fr)] md:items-center md:gap-16">
          {/* Headline on the calm part of the photo */}
          <motion.section className="pb-4 pt-8 md:order-2 md:pb-0 md:pt-0"
            initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05, ease }}>
            <p className="text-[13px] font-medium text-accent">{t('loginKicker')}</p>
            <h1 className="mt-3 max-w-[18ch] font-display text-[25px] font-medium leading-[1.45] md:text-[44px] md:leading-[1.3]">{t('loginHeadline')}</h1>
            <p className="mt-3 max-w-[34rem] text-[15px] leading-7 text-muted md:mt-4 md:text-lg md:leading-8">{t('loginSub')}</p>
            <div className="max-w-[26rem]"><DimensionLine label={t('loginDisciplines')} /></div>
          </motion.section>

          {/* One glass card that holds the form */}
          <motion.div className="mt-auto pt-[84px] md:order-1 md:mt-0"
            initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.15, ease }}>
            <div className="relative rounded-[20px] border border-line bg-[rgb(var(--surface)/0.82)] p-5 text-ink shadow-[0_24px_60px_-24px_rgb(var(--shadow)/0.35)] backdrop-blur-2xl backdrop-saturate-150 md:p-8">
              <Majed className="end-3 md:end-6" />
              <form onSubmit={submit}>
                <h2 className="font-display text-[20px] font-medium">{t('signInTitle')}</h2>
                <p className="mt-1 text-[14px] leading-6 text-muted">{t('signInHint')}</p>

                <label className="mb-2 mt-6 block text-[13px] font-medium text-muted" htmlFor="email">{t('email')}</label>
                <input id="email" className="field h-12 rounded-[10px] bg-surface/70" type="email" inputMode="email" autoComplete="username" dir="ltr" required
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />

                <div className="mb-2 mt-4 flex items-center justify-between">
                  <label className="text-[13px] font-medium text-muted" htmlFor="password">{t('password')}</label>
                  <a className="text-[13px] font-medium text-accent hover:underline" href={`${WEBSITE}/web/reset_password`} target="_blank" rel="noreferrer">{t('forgot')}</a>
                </div>
                <div className="relative">
                  <input id="password" className="field h-12 rounded-[10px] bg-surface/70 pe-12" type={show ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="absolute inset-y-0 end-1 grid w-10 place-items-center text-muted transition-colors hover:text-ink" onClick={() => setShow((s) => !s)}
                    aria-label={show ? t('hidePassword') : t('showPassword')}>
                    {show ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                  </button>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}
                      className="mt-4 rounded-[10px] border border-live/20 bg-live/10 px-3 py-2.5 text-[13px] font-medium leading-6 text-live" role="alert">{error}</motion.p>
                  )}
                </AnimatePresence>

                <button className="btn-primary mt-6 h-12 w-full rounded-[10px] text-[15px] font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]" disabled={busy}>
                  {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : null}
                  {busy ? t('signingIn') : t('signIn')}
                  {!busy && <ArrowLeft className="h-[18px] w-[18px] ltr:rotate-180" strokeWidth={1.75} />}
                </button>

                <p className="mt-5 text-center text-[13px] text-muted">
                  {t('notMember')}{' '}
                  <a className="font-medium text-accent hover:underline" href={WEBSITE} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>
                </p>

                {import.meta.env.DEV && (
                  <div className="mt-6 rounded-[10px] border border-dashed border-line p-3 text-xs text-muted">
                    <p className="mb-2 font-medium">Dev only: sign in as an Odoo partner</p>
                    <div className="flex gap-2">
                      <input className="field h-10 text-sm" dir="ltr" placeholder="partner id" value={devPartner} onChange={(e) => setDevPartner(e.target.value)} />
                      <button type="button" className="btn-soft h-10" onClick={async () => {
                        try { await devLoginAs(Number(devPartner)); navigate('/', { replace: true }) } catch (err) { setError(err instanceof ApiError ? err.message : String(err)) }
                      }}>Go</button>
                    </div>
                  </div>
                )}
              </form>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
