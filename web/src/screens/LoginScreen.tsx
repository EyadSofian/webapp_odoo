import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import { ApiError, devLoginAs, login } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { motion } from '../lib/motion'
import { Logo } from '../components/ui'

const WEBSITE = 'https://engosoft.com'

export function LoginScreen() {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
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

  return (
    <div className="flex min-h-dvh flex-col bg-surface md:flex-row">

      {/* Photo side */}
      <div className="relative h-[38vh] min-h-[260px] overflow-hidden md:h-auto md:min-h-dvh md:flex-1">
        <motion.img src="/art/login-hero.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]"
          initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.6, ease: [0.2, 0.8, 0.2, 1] }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgb(6_32_58/0.92)] via-[rgb(6_32_58/0.35)] to-[rgb(6_32_58/0.25)]" />
        <div className="relative flex h-full flex-col justify-between p-5 pt-[calc(20px+var(--safe-top))] md:p-12">
          <div className="flex items-center justify-between">
            <Logo variant="white" className="h-8 w-auto md:h-10" />
            <button className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-sm font-bold text-white backdrop-blur" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }} className="hidden max-w-lg text-white md:block">
            <p className="font-display text-4xl font-bold leading-[1.35]">{lang === 'ar' ? 'محاضراتك، تسجيلاتك، وجروب كورسك.' : 'Your sessions, recordings and course group.'}</p>
            <p className="mt-4 text-lg text-white/75">{lang === 'ar' ? 'كل اللي محتاجه عشان تكمّل مسارك الهندسي، في مكان واحد.' : 'Everything you need to keep your engineering track moving.'}</p>
          </motion.div>
        </div>
      </div>

      {/* Form side */}
      <div className="relative -mt-7 flex flex-1 items-start justify-center rounded-t-[28px] bg-surface px-6 pb-[calc(24px+var(--safe-bottom))] pt-8 md:mt-0 md:max-w-[560px] md:items-center md:rounded-none md:px-16">
        <motion.form onSubmit={submit} className="w-full max-w-sm" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
          <h1 className="font-display text-[26px] font-bold leading-snug">{lang === 'ar' ? 'أهلاً بيك' : 'Welcome back'}</h1>
          <p className="mb-8 mt-1 text-[15px] text-muted">{t('signInHint')}</p>

          <label className="mb-1.5 block text-sm font-bold" htmlFor="email">{t('email')}</label>
          <input id="email" className="field mb-5" type="email" inputMode="email" autoComplete="username" dir="ltr" required
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />

          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-bold" htmlFor="password">{t('password')}</label>
            <a className="text-sm font-bold text-accent" href={`${WEBSITE}/web/reset_password`} target="_blank" rel="noreferrer">{t('forgot')}</a>
          </div>
          <div className="relative mb-6">
            <input id="password" className="field pe-12" type={show ? 'text' : 'password'} autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="absolute inset-y-0 end-1 grid w-10 place-items-center text-muted" onClick={() => setShow((s) => !s)} aria-label="toggle password">
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-xl bg-live/10 px-4 py-3 text-sm font-bold text-live" role="alert">{error}</motion.p>}

          <button className="btn-primary group h-12 w-full text-base" disabled={busy}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {busy ? t('signingIn') : t('signIn')}
            {!busy && <ArrowLeft className="h-5 w-5 transition group-hover:-translate-x-1 ltr:rotate-180 ltr:group-hover:translate-x-1" />}
          </button>

          <p className="mt-8 text-center text-sm text-muted">
            {t('notMember')}{' '}
            <a className="font-bold text-accent" href={WEBSITE} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>
          </p>

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
        </motion.form>
      </div>
    </div>
  )
}
