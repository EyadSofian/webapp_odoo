import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { ApiError, devLoginAs, getRemember, login, setRemember } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { AnimatePresence, motion } from '../lib/motion'
import { Logo } from '../components/ui'
import { Majed } from '../components/Majed'

const WEBSITE = 'https://engosoft.com'
const ease = [0.22, 1, 0.36, 1] as const

/**
 * Sign-in as a short conversation with Majed: he greets, asks for the email, then the password.
 * Both inputs stay in one form so password managers and autofill keep working.
 */

type Msg = { id: number; from: 'majed' | 'me'; text: string; tone?: 'error' }

/** The browser's saved-password API (Chrome, Edge, Android). Safari and Firefox fall back to normal autofill. */
type PwCred = { id: string; password?: string; type: string }
type CredApi = {
  get: (o: { password: boolean; mediation: 'optional' | 'silent' }) => Promise<PwCred | null>
  store: (c: unknown) => Promise<unknown>
}
const credApi = (): CredApi | null =>
  typeof window !== 'undefined' && 'PasswordCredential' in window ? (navigator.credentials as unknown as CredApi) : null
const validEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim())
type Step = 'email' | 'password'

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="…">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </span>
  )
}

function MajedFace() {
  return (
    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-brand-50 ring-1 ring-line">
      <img src="/art/majed.webp" alt="" className="h-[150%] w-full object-cover object-top" />
    </span>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const mine = msg.from === 'me'
  return (
    <motion.div layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease }}
      className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && <MajedFace />}
      <p dir="auto" className={[
        'max-w-[80%] rounded-[18px] px-4 py-2.5 text-[15px] leading-7',
        mine ? 'rounded-ee-[6px] bg-brand-500 text-white' : 'rounded-es-[6px] bg-sunken text-ink',
        msg.tone === 'error' ? '!bg-live/10 !text-live' : '',
      ].join(' ')}>
        {msg.text}
      </p>
    </motion.div>
  )
}

export function LoginScreen() {
  const { t, lang, setLang } = useI18n()
  const { resolved, setTheme } = useTheme()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(true)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [nod, setNod] = useState(0)
  const [devPartner, setDevPartner] = useState('')
  const [remember, setRememberState] = useState(getRemember)
  const signingIn = useRef(false)
  const nextId = useRef(1)
  const pwRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const push = (from: Msg['from'], text: string, tone?: Msg['tone']) =>
    setMsgs((m) => [...m, { id: nextId.current++, from, text, tone }])

  /** Majed "types" for a moment, then says it, and nods. */
  const say = (text: string, tone?: Msg['tone'], wait = 650) =>
    new Promise<void>((resolve) => {
      setTyping(true)
      window.setTimeout(() => { setTyping(false); push('majed', text, tone); setNod((n) => n + 1); resolve() }, reduce ? 0 : wait)
    })

  // Opening lines in the current language; they restart when the language changes.
  useEffect(() => {
    setMsgs([]); setStep('email'); setPassword('')
    let alive = true
    const run = async () => {
      await new Promise((r) => setTimeout(r, reduce ? 0 : 900))
      if (!alive) return
      await say(t('chatHello'), undefined, 500)
      if (!alive) return
      await say(t('chatAskEmail'), undefined, 800)
      if (!alive) return
      // Saved account in this browser: offer it, and sign in straight away when it is picked.
      const api = credApi()
      if (api && getRemember()) {
        const cred = await api.get({ password: true, mediation: 'optional' }).catch(() => null)
        if (alive && cred?.type === 'password' && cred.password) {
          setEmail(cred.id); setPassword(cred.password)
          void signIn(cred.id, cred.password)
        }
      }
    }
    void run()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }) }, [msgs, typing, reduce])
  useEffect(() => { if (step === 'password') pwRef.current?.focus({ preventScroll: true }) }, [step])

  /** Signs in with both values at once (typed, autofilled, or a saved account). */
  const signIn = async (mail: string, pass: string) => {
    if (signingIn.current) return
    signingIn.current = true
    if (step === 'email') push('me', mail.trim())
    setStep('password')
    push('me', '•'.repeat(Math.min(pass.length, 10)))
    setBusy(true)
    setTyping(true)
    try {
      const res = await login(mail.trim(), pass)
      // Let the browser save (or update) the password, which also enables one-tap sign-in next time.
      const api = credApi()
      if (api && getRemember()) {
        try {
          const Ctor = (window as unknown as { PasswordCredential: new (d: { id: string; password: string; name?: string }) => unknown }).PasswordCredential
          await api.store(new Ctor({ id: mail.trim(), password: pass, name: res.user.name }))
        } catch { /* the person can still save it from the browser's own prompt */ }
      }
      setTyping(false)
      push('majed', t('chatWelcome'))
      setNod((n) => n + 1)
      window.setTimeout(() => navigate('/', { replace: true }), reduce ? 0 : 700)
    } catch (err) {
      setTyping(false)
      setPassword('')
      push('majed', err instanceof ApiError ? err.message : t('offline'), 'error')
      setNod((n) => n + 1)
      pwRef.current?.focus()
    } finally {
      setBusy(false)
      signingIn.current = false
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || typing) return
    if (step === 'email') {
      if (!validEmail(email)) { await say(t('chatBadEmail'), 'error', 350); return }
      // Autofill filled the password too: no need to ask for it.
      if (password) { void signIn(email, password); return }
      push('me', email.trim())
      setStep('password')
      await say(t('chatAskPassword'))
      return
    }
    if (!password) return
    void signIn(email, password)
  }

  // A password manager filled both fields while we were still on the email step: sign in right away.
  useEffect(() => {
    if (step !== 'email' || !password || !validEmail(email) || typing || busy) return
    const id = window.setTimeout(() => void signIn(email, password), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password])

  const changeEmail = () => {
    setStep('email'); setPassword('')
    push('majed', t('chatAskEmail')); setNod((n) => n + 1)
    window.setTimeout(() => emailRef.current?.focus(), 0)
  }

  const tool = 'grid h-9 min-w-9 place-items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink'
  const chip = 'rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-sunken'

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg text-ink">

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 pb-2 pt-[calc(14px+var(--safe-top))] md:px-8 md:pt-6">
        <Logo className="h-9 w-auto md:h-10" />
        <div className="flex items-center gap-1">
          <button className={tool} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} aria-label={t('appearance')}>
            {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" strokeWidth={2} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={2} />}
          </button>
          <button className={tool} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-end px-4 pb-[calc(16px+var(--safe-bottom))] pt-28 md:justify-center md:pb-10">
        <motion.section className="relative w-full max-w-[440px]"
          initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
          <div className="relative rounded-[28px] border border-line bg-surface shadow-[0_30px_80px_-30px_rgb(var(--shadow)/0.35)]">
            <Majed centered bubble={false} nodKey={nod} />

            <div className="border-b border-line px-5 pb-3 pt-4 text-center">
              <p className="text-[16px] font-bold">{t('majedName')}</p>
              <p className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />{t('majedRole')}
              </p>
            </div>

            <div ref={listRef} className="flex max-h-[42dvh] min-h-[180px] flex-col gap-3 overflow-y-auto px-4 py-4 md:max-h-[360px]" aria-live="polite">
              {msgs.map((m) => <Bubble key={m.id} msg={m} />)}
              <AnimatePresence>
                {typing && (
                  <motion.div className="flex items-end gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <MajedFace />
                    <span className="rounded-[18px] rounded-es-[6px] bg-sunken px-4 py-2"><TypingDots /></span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {step === 'password' && !busy && (
              <div className="flex flex-wrap gap-2 px-4 pb-3">
                <button type="button" role="switch" aria-checked={remember} onClick={() => { setRemember(!remember); setRememberState(!remember) }}
                  className={`${chip} inline-flex items-center gap-2 ${remember ? '!border-brand-500/40 !bg-brand-50 !text-accent' : ''}`}>
                  <span className={`grid h-4 w-4 place-items-center rounded-[5px] border ${remember ? 'border-brand-500 bg-brand-500 text-white' : 'border-line'}`}>
                    {remember && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {t('rememberMe')}
                </button>
                <a className={chip} href={`${WEBSITE}/web/reset_password`} target="_blank" rel="noreferrer">{t('forgot')}</a>
                <button type="button" className={chip} onClick={changeEmail}>{t('chatChangeEmail')}</button>
              </div>
            )}

            {/* Composer: one form with both fields; the email stays in the form (hidden) for autofill */}
            <form onSubmit={submit} method="post" autoComplete="on" className="border-t border-line p-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input ref={emailRef} id="email" name="username" aria-label={t('email')} type="email" inputMode="email" autoComplete="username" dir="ltr"
                    value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" tabIndex={step === 'email' ? 0 : -1}
                    className={step === 'email' ? 'field h-12 rounded-full border-transparent bg-sunken px-5' : 'pointer-events-none absolute h-px w-px opacity-0'} />
                  {/* Always in the page (hidden on the email step) so autofill can fill both fields in one go */}
                  <input ref={pwRef} id="password" name="password" aria-label={t('password')} type={show ? 'text' : 'password'} autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('password')} tabIndex={step === 'password' ? 0 : -1}
                    className={step === 'password' ? 'field h-12 rounded-full border-transparent bg-sunken pe-12 ps-5' : 'pointer-events-none absolute h-px w-px opacity-0'} />
                  {step === 'password' && (
                    <button type="button" className="absolute inset-y-0 end-2 grid w-9 place-items-center text-muted hover:text-ink" onClick={() => setShow((v) => !v)}
                      aria-label={show ? t('hidePassword') : t('showPassword')}>
                      {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  )}
                </div>
                <button className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-500 text-white transition-[background-color,transform] hover:bg-brand-600 active:scale-95 disabled:opacity-50"
                  disabled={busy || typing} aria-label={step === 'email' ? t('next') : t('signIn')}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowLeft className="h-5 w-5 ltr:rotate-180" strokeWidth={2.25} />}
                </button>
              </div>
            </form>
          </div>

          <p className="mt-5 text-center text-[13px] text-muted">
            {t('notMember')}{' '}
            <a className="font-semibold text-accent hover:underline" href={WEBSITE} target="_blank" rel="noreferrer">{t('browseWebsite')}</a>
          </p>

          {import.meta.env.DEV && (
            <div className="mt-4 rounded-[12px] border border-dashed border-line p-3 text-xs text-muted">
              <p className="mb-2 font-medium">Dev only: sign in as an Odoo partner</p>
              <div className="flex gap-2">
                <input className="field h-10 text-sm" dir="ltr" placeholder="partner id" value={devPartner} onChange={(e) => setDevPartner(e.target.value)} />
                <button type="button" className="btn-soft h-10" onClick={async () => {
                  try { await devLoginAs(Number(devPartner)); navigate('/', { replace: true }) } catch (err) { push('majed', err instanceof ApiError ? err.message : String(err), 'error') }
                }}>Go</button>
              </div>
            </div>
          )}
        </motion.section>
      </main>
    </div>
  )
}
