import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, ClipboardList, Download, FileText, Loader2, Lock, Paperclip, Plus, Send, Trash2, Trophy, X, XCircle,
} from 'lucide-react'
import { ApiError, api, fetchBlobUrl } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { fileSize, formatDate, formatTime } from '../lib/format'
import { AnimatePresence, Reveal, motion } from '../lib/motion'
import type { AssessmentDetail, AttemptDto, AttemptResult, QuestionDto, SubmissionDto } from '../lib/types'
import { ErrorState, ProgressBar, ProgressRing, Segmented, Skeleton, TopBar, useToast } from '../components/ui'

export function AssessmentScreen() {
  const { id = '' } = useParams()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['assessment', id], queryFn: () => api<AssessmentDetail>(`/api/assessments/${id}`) })
  return (
    <div className="mx-auto min-h-dvh max-w-4xl pb-16">
      <TopBar back={data ? `/live/${data.card.eventId}` : true} title={data?.card.title} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4"><Skeleton className="h-48 w-full" /><Skeleton className="h-24 w-full" /></div>}
      {data && (data.isStaff ? <StaffView a={data} /> : data.card.kind === 'quiz' ? <TakeQuiz a={data} /> : <TaskView a={data} />)}
    </div>
  )
}

function Header({ a, children }: { a: AssessmentDetail; children?: React.ReactNode }) {
  const { t, lang } = useI18n()
  return (
    <div className="relative mx-4 mt-4 overflow-hidden rounded-3xl text-white md:mx-8">
      <img src="/art/exam.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(6_32_58/0.95)] via-[rgb(6_32_58/0.7)] to-[rgb(6_32_58/0.35)]" />
      <div className="relative p-5 pt-16 md:p-8 md:pt-24">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="chip bg-white/15 text-white backdrop-blur">{a.card.kind === 'quiz' ? t('quiz') : t('task')}</span>
          {a.card.aiGenerated && <span className="chip bg-white/15 text-white backdrop-blur"><Bot className="h-3.5 w-3.5" />{t('aiMade')}</span>}
          {a.isStaff && <span className={clsx('chip', a.card.status === 'published' ? 'bg-ok text-white' : a.card.status === 'draft' ? 'bg-gold text-white' : 'bg-white/20 text-white')}>{t(a.card.status)}</span>}
        </div>
        <h2 className="font-display text-2xl font-bold leading-snug md:text-3xl" dir="auto">{a.card.title}</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/80">
          {a.card.kind === 'quiz' && <span><span className="num">{a.card.questionCount}</span> {t('question')}</span>}
          {a.card.kind === 'quiz' && <span>{t('passMark')} <span className="num">{a.card.passPercent}%</span></span>}
          {a.card.dueAt && <span>{t('due')} <span className="num">{formatDate(a.card.dueAt, lang)} · {formatTime(a.card.dueAt, lang)}</span></span>}
        </div>
        {children}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ learner: quiz

function TakeQuiz({ a }: { a: AssessmentDetail }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<'intro' | 'answering' | 'result'>('intro')
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<AttemptResult | null>(null)
  const used = a.myAttempts.length
  const left = a.card.maxAttempts - used
  const closed = a.card.status !== 'published' || (a.card.dueAt && new Date(a.card.dueAt) < new Date())
  const best = a.myAttempts.reduce<AttemptDto | null>((b, x) => (!b || x.percent > b.percent ? x : b), null)

  const submit = useMutation({
    mutationFn: () => api<AttemptResult>(`/api/assessments/${a.card.id}/attempts`, { method: 'POST', json: { answers } }),
    onSuccess: (r) => {
      setResult(r); setStage('result')
      void queryClient.invalidateQueries({ queryKey: ['assessment', a.card.id] })
      void queryClient.invalidateQueries({ queryKey: ['pending-assessments'] })
      void queryClient.invalidateQueries({ queryKey: ['assessments'] })
    },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  if (stage === 'result' && result) return <QuizResult a={a} r={result} answers={answers} onRetry={() => { setAnswers({}); setIndex(0); setResult(null); setStage('answering') }} />

  if (stage === 'intro') {
    return (
      <>
        <Header a={a} />
        <div className="space-y-4 px-4 py-5 md:px-8">
          {a.instructions && <p className="card p-4 text-[15px] leading-7" dir="auto">{a.instructions}</p>}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card p-3"><p className="num text-xl font-bold">{a.card.questionCount}</p><p className="text-xs text-muted">{t('question')}</p></div>
            <div className="card p-3"><p className="num text-xl font-bold">{Math.max(0, left)}</p><p className="text-xs text-muted">{t('attemptsLeft')}</p></div>
            <div className="card p-3"><p className="num text-xl font-bold">{best ? `${Math.round(best.percent)}%` : '—'}</p><p className="text-xs text-muted">{t('yourScore')}</p></div>
          </div>
          {closed || left <= 0 ? (
            <div className="card flex items-center gap-3 p-4 text-sm"><Lock className="h-5 w-5 text-muted" />{left <= 0 ? `${t('attemptsLeft')}: 0` : t('closed')}</div>
          ) : (
            <motion.button whileTap={{ scale: 0.98 }} className="btn-primary h-12 w-full text-base" onClick={() => setStage('answering')}>
              {used ? t('retake') : t('startQuiz')}<ArrowLeft className="h-5 w-5 ltr:rotate-180" />
            </motion.button>
          )}
        </div>
      </>
    )
  }

  const q = a.questions[index]
  const answered = Object.keys(answers).length
  const last = index === a.questions.length - 1
  return (
    <div className="px-4 py-5 md:px-8">
      <div className="mb-5 flex items-center gap-3">
        <span className="num text-sm font-bold text-muted">{index + 1}/{a.questions.length}</span>
        <ProgressBar value={((index + 1) / a.questions.length) * 100} className="h-2 flex-1" />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={q.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
          <h3 className="mb-5 font-display text-xl font-bold leading-relaxed md:text-2xl" dir="auto">{q.text}</h3>
          <div className="grid gap-3">
            {q.options.map((o, i) => {
              const chosen = answers[q.id] === o.id
              return (
                <motion.button key={o.id} whileTap={{ scale: 0.985 }}
                  className={clsx('flex items-center gap-3 rounded-2xl border-2 p-4 text-start text-[15px] transition',
                    chosen ? 'border-brand-500 bg-brand-50 shadow-card' : 'border-line bg-surface hover:border-brand-200')}
                  onClick={() => setAnswers((x) => ({ ...x, [q.id]: o.id }))}>
                  <span className={clsx('num grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', chosen ? 'bg-brand-500 text-white' : 'bg-sunken text-muted')}>
                    {chosen ? <Check className="h-4 w-4" /> : (lang === 'ar' ? 'أبجدهو' : 'ABCDEF')[i]}
                  </span>
                  <span className="flex-1 leading-7" dir="auto">{o.text}</span>
                </motion.button>
              )
            })}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="sticky bottom-0 mt-8 flex items-center gap-3 bg-gradient-to-t from-bg via-bg pb-[calc(12px+var(--safe-bottom))] pt-4">
        <button className="btn-ghost h-12 w-12 p-0" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}><ArrowRight className="h-5 w-5 ltr:rotate-180" /></button>
        {last ? (
          <button className="btn-primary h-12 flex-1" disabled={submit.isPending || answered === 0} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 rtl:rotate-180" />}
            {t('submitAnswers')} <span className="num opacity-80">({answered}/{a.questions.length})</span>
          </button>
        ) : (
          <button className="btn-primary h-12 flex-1" onClick={() => setIndex((i) => i + 1)}>{t('next')}<ArrowLeft className="h-5 w-5 ltr:rotate-180" /></button>
        )}
      </div>
    </div>
  )
}

function QuizResult({ a, r, answers, onRetry }: { a: AssessmentDetail; r: AttemptResult; answers: Record<string, string>; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="px-4 py-6 md:px-8">
      <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className={clsx('card overflow-hidden p-6 text-center', r.passed ? 'ring-2 ring-ok/40' : 'ring-2 ring-warn/30')}>
        <motion.div initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 14 }}
          className={clsx('mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full', r.passed ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
          {r.passed ? <Trophy className="h-8 w-8" /> : <ClipboardList className="h-8 w-8" />}
        </motion.div>
        <ProgressRing value={r.percent} size={110} stroke={9}><span className="text-xl">{Math.round(r.percent)}%</span></ProgressRing>
        <p className="mt-3 font-display text-xl font-bold">{r.passed ? t('passed') : t('notPassed')}</p>
        <p className="num text-sm text-muted">{r.score}/{r.maxScore} · {r.attemptsLeft} {t('attemptsLeft')}</p>
        {!r.passed && r.attemptsLeft > 0 && <button className="btn-primary mt-4" onClick={onRetry}>{t('retake')}</button>}
      </motion.div>

      <h3 className="section-title mb-3 mt-8">{t('review')}</h3>
      <div className="space-y-3">
        {a.questions.map((q, i) => {
          const rv = r.review.find((x) => x.questionId === q.id)
          return (
            <Reveal key={q.id} delay={Math.min(i * 0.04, 0.3)}>
              <div className="card p-4">
                <div className="flex items-start gap-2">
                  {rv?.isCorrect ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-ok" /> : <XCircle className="mt-1 h-5 w-5 shrink-0 text-live" />}
                  <p className="font-bold leading-7" dir="auto">{q.text}</p>
                </div>
                <ul className="mt-3 space-y-1.5 ps-7">
                  {q.options.map((o) => {
                    const mine = answers[q.id] === o.id
                    const right = rv?.correct?.includes(o.id)
                    return (
                      <li key={o.id} className={clsx('rounded-xl px-3 py-2 text-sm', right ? 'bg-ok/10 font-bold text-ok' : mine ? 'bg-live/10 text-live' : 'text-muted')} dir="auto">
                        {o.text}{mine && !right ? ` · ${t('yourAnswer')}` : ''}
                      </li>
                    )
                  })}
                </ul>
                {rv?.explanation && <p className="mt-3 rounded-xl bg-sunken p-3 text-sm leading-6" dir="auto">{rv.explanation}</p>}
              </div>
            </Reveal>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ learner: task

function TaskView({ a }: { a: AssessmentDetail }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [text, setText] = useState(a.mySubmission?.text ?? '')
  const [files, setFiles] = useState<File[]>([])
  const graded = a.mySubmission?.grade != null
  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('text', text)
      files.forEach((f) => form.append('files', f))
      return api<SubmissionDto>(`/api/assessments/${a.card.id}/submission`, { method: 'POST', body: form })
    },
    onSuccess: () => {
      toast({ kind: 'ok', text: t('submitted') }); setFiles([])
      void queryClient.invalidateQueries({ queryKey: ['assessment', a.card.id] })
      void queryClient.invalidateQueries({ queryKey: ['pending-assessments'] })
    },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })
  return (
    <>
      <Header a={a} />
      <div className="space-y-4 px-4 py-5 md:px-8">
        {a.instructions && <div className="card whitespace-pre-wrap p-4 text-[15px] leading-7" dir="auto">{a.instructions}</div>}
        {a.mySubmission && (
          <div className={clsx('card p-4', graded && 'ring-2 ring-ok/40')}>
            <p className="text-sm font-bold">{t('yourSubmission')} · <span className="num text-muted">{formatDate(a.mySubmission.submittedAt, lang)}</span>{a.mySubmission.late && <span className="chip ms-2 bg-warn/10 text-warn">{t('late')}</span>}</p>
            {graded && <p className="mt-2 font-display text-2xl font-bold text-ok"><span className="num">{a.mySubmission.grade}</span><span className="text-sm text-muted">/100</span></p>}
            {a.mySubmission.feedback && <p className="mt-2 rounded-xl bg-sunken p-3 text-sm leading-6" dir="auto">{a.mySubmission.feedback}</p>}
            <Files files={a.mySubmission.files} />
          </div>
        )}
        {!graded && a.card.status === 'published' && (
          <div className="card space-y-3 p-4">
            <textarea className="field min-h-[160px] resize-y py-3 leading-7" placeholder={t('writeAnswer')} value={text} onChange={(e) => setText(e.target.value)} dir="auto" maxLength={8000} />
            <label className="btn-soft w-fit">
              <Paperclip className="h-4 w-4" />{t('attach')}
              <input type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
            </label>
            {files.length > 0 && <ul className="space-y-1 text-sm text-muted">{files.map((f) => <li key={f.name}>📎 {f.name} · {fileSize(f.size)}</li>)}</ul>}
            <button className="btn-primary w-full" disabled={submit.isPending || (!text.trim() && files.length === 0)} onClick={() => submit.mutate()}>
              {submit.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 rtl:rotate-180" />}{t('submit')}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function Files({ files }: { files: SubmissionDto['files'] }) {
  if (!files.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {files.map((f) => (
        <button key={f.id} className="chip h-8 bg-sunken text-ink" onClick={async () => {
          const href = await fetchBlobUrl(`/api/assessments/files/${f.id}`)
          const link = document.createElement('a'); link.href = href; link.download = f.name; link.click()
        }}><Download className="h-3.5 w-3.5" />{f.name}</button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ course team

type Draft = { text: string; explanation: string; options: { text: string; isCorrect: boolean }[] }
const toDraft = (q: QuestionDto): Draft => ({ text: q.text, explanation: q.explanation ?? '', options: q.options.map((o) => ({ text: o.text, isCorrect: !!o.isCorrect })) })

function StaffView({ a }: { a: AssessmentDetail }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'edit' | 'results'>(a.card.status === 'draft' ? 'edit' : 'results')
  return (
    <>
      <Header a={a} />
      <div className="px-4 pt-5 md:px-8">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'edit', label: t('edit') },
          { value: 'results', label: a.card.kind === 'quiz' ? t('results') : t('submissions') },
        ]} />
      </div>
      {tab === 'edit' ? <Editor a={a} /> : a.card.kind === 'quiz' ? <Results id={a.card.id} /> : <Submissions id={a.card.id} />}
    </>
  )
}

function Editor({ a }: { a: AssessmentDetail }) {
  const { t } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(a.card.title)
  const [instructions, setInstructions] = useState(a.instructions ?? '')
  const [dueAt, setDueAt] = useState(a.card.dueAt ? a.card.dueAt.slice(0, 16) : '')
  const [maxAttempts, setMaxAttempts] = useState(a.card.maxAttempts)
  const [pass, setPass] = useState(a.card.passPercent)
  const [questions, setQuestions] = useState<Draft[]>(() => a.questions.map(toDraft))
  const locked = (a.card.stats?.attempts ?? 0) > 0
  useEffect(() => { setQuestions(a.questions.map(toDraft)) }, [a.questions])

  const body = () => ({
    kind: a.card.kind, title, instructions, trackId: a.card.trackId, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    timeLimitMinutes: a.timeLimitMinutes, maxAttempts, passPercent: pass, revealAnswers: a.revealAnswers,
    questions: a.card.kind === 'quiz' && !locked ? questions.map((q) => ({ text: q.text, explanation: q.explanation, points: 1, options: q.options })) : null,
  })
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['assessment', a.card.id] }); void queryClient.invalidateQueries({ queryKey: ['assessments'] }) }
  const fail = (e: unknown) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) })
  const save = useMutation({ mutationFn: () => api(`/api/assessments/${a.card.id}`, { method: 'PUT', json: body() }), onSuccess: () => { toast({ kind: 'ok', text: '✓' }); refresh() }, onError: fail })
  const publish = useMutation({
    mutationFn: async () => { await api(`/api/assessments/${a.card.id}`, { method: 'PUT', json: body() }); return api(`/api/assessments/${a.card.id}/publish`, { method: 'POST' }) },
    onSuccess: () => { toast({ kind: 'ok', text: t('published') }); refresh() }, onError: fail,
  })
  const close = useMutation({ mutationFn: () => api(`/api/assessments/${a.card.id}/close`, { method: 'POST' }), onSuccess: refresh, onError: fail })
  const remove = useMutation({ mutationFn: () => api(`/api/assessments/${a.card.id}`, { method: 'DELETE' }), onSuccess: () => navigate(`/live/${a.card.eventId}`, { replace: true }), onError: fail })

  const setQ = (i: number, q: Partial<Draft>) => setQuestions((all) => all.map((x, j) => (j === i ? { ...x, ...q } : x)))

  return (
    <div className="space-y-4 px-4 py-5 md:px-8">
      <div className="card grid gap-3 p-4 md:grid-cols-2">
        <label className="md:col-span-2"><span className="mb-1 block text-sm font-bold">{t('title')}</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></label>
        <label className="md:col-span-2"><span className="mb-1 block text-sm font-bold">{t('instructions')}</span><textarea className="field min-h-[90px] py-3" value={instructions} onChange={(e) => setInstructions(e.target.value)} dir="auto" /></label>
        <label><span className="mb-1 block text-sm font-bold">{t('due')}</span><input type="datetime-local" className="field" value={dueAt} onChange={(e) => setDueAt(e.target.value)} dir="ltr" /></label>
        {a.card.kind === 'quiz' && (
          <div className="grid grid-cols-2 gap-3">
            <label><span className="mb-1 block text-sm font-bold">{t('attemptsLeft')}</span><input type="number" min={1} max={10} className="field" value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} /></label>
            <label><span className="mb-1 block text-sm font-bold">{t('passMark')} %</span><input type="number" min={0} max={100} className="field" value={pass} onChange={(e) => setPass(Number(e.target.value))} /></label>
          </div>
        )}
      </div>

      {a.card.kind === 'quiz' && (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <motion.div layout key={i} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="num grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-accent">{i + 1}</span>
                <input className="field h-11 flex-1 font-bold" value={q.text} disabled={locked} onChange={(e) => setQ(i, { text: e.target.value })} dir="auto" />
                {!locked && <button className="btn-ghost h-10 w-10 p-0 text-live" onClick={() => setQuestions((all) => all.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
              <div className="space-y-2 ps-9">
                {q.options.map((o, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <button disabled={locked} onClick={() => setQ(i, { options: q.options.map((x, k) => ({ ...x, isCorrect: k === j })) })}
                      className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full border-2', o.isCorrect ? 'border-ok bg-ok text-white' : 'border-line')} aria-label="correct">
                      {o.isCorrect && <Check className="h-4 w-4" />}
                    </button>
                    <input className="field h-10 flex-1 text-sm" value={o.text} disabled={locked} dir="auto"
                      onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)) })} />
                    {!locked && q.options.length > 2 && <button className="text-muted" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })}><X className="h-4 w-4" /></button>}
                  </div>
                ))}
                {!locked && q.options.length < 6 && <button className="text-sm font-bold text-accent" onClick={() => setQ(i, { options: [...q.options, { text: '', isCorrect: false }] })}>+ {t('addOption')}</button>}
                <textarea className="field min-h-[60px] py-2 text-sm" placeholder={t('explanation')} value={q.explanation} disabled={locked} onChange={(e) => setQ(i, { explanation: e.target.value })} dir="auto" />
              </div>
            </motion.div>
          ))}
          {!locked && (
            <button className="btn-soft w-full" onClick={() => setQuestions((all) => [...all, { text: '', explanation: '', options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }, { text: '', isCorrect: false }, { text: '', isCorrect: false }] }])}>
              <Plus className="h-4 w-4" />{t('addQuestion')}
            </button>
          )}
        </div>
      )}

      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-bg via-bg pb-[calc(12px+var(--safe-bottom))] pt-4">
        <button className="btn-soft flex-1" onClick={() => save.mutate()} disabled={save.isPending}>{t('save')}</button>
        {a.card.status !== 'published' && <button className="btn-primary flex-1" onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t('publish')}</button>}
        {a.card.status === 'published' && <button className="btn-ghost flex-1 border border-line" onClick={() => close.mutate()}>{t('closeIt')}</button>}
        {a.card.status === 'draft' && <button className="btn-ghost h-11 w-11 p-0 text-live" onClick={() => remove.mutate()} aria-label="delete"><Trash2 className="h-5 w-5" /></button>}
      </div>
    </div>
  )
}

function Results({ id }: { id: string }) {
  const { t, lang } = useI18n()
  const { data, isLoading } = useQuery({ queryKey: ['results', id], queryFn: () => api<AttemptDto[] & { partnerName?: string }[]>(`/api/assessments/${id}/results`) })
  const avg = useMemo(() => (data?.length ? Math.round(data.reduce((s, x) => s + x.percent, 0) / data.length) : null), [data])
  if (isLoading) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>
  return (
    <div className="space-y-3 px-4 py-5 md:px-8">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="card p-4"><p className="num text-2xl font-bold">{data?.length ?? 0}</p><p className="text-xs text-muted">{t('results')}</p></div>
        <div className="card p-4"><p className="num text-2xl font-bold">{avg != null ? `${avg}%` : '—'}</p><p className="text-xs text-muted">{t('yourScore')}</p></div>
      </div>
      {data?.map((r) => (
        <div key={r.id} className="card flex items-center gap-3 p-3">
          <ProgressRing value={r.percent} size={40} stroke={4} />
          <span className="num flex-1 text-sm text-muted">{formatDate(r.submittedAt, lang)} · {r.score}/{r.maxScore}</span>
          <span className={clsx('chip', r.passed ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>{r.passed ? t('passed') : t('notPassed')}</span>
        </div>
      ))}
    </div>
  )
}

function Submissions({ id }: { id: string }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['submissions', id], queryFn: () => api<SubmissionDto[]>(`/api/assessments/${id}/submissions`) })
  const [draft, setDraft] = useState<Record<string, { grade: string; feedback: string }>>({})
  const grade = useMutation({
    mutationFn: (s: SubmissionDto) => api(`/api/assessments/submissions/${s.id}/grade`, { method: 'POST', json: { grade: Number(draft[s.id]?.grade ?? s.grade ?? 0), feedback: draft[s.id]?.feedback ?? s.feedback } }),
    onSuccess: () => { toast({ kind: 'ok', text: '✓' }); void queryClient.invalidateQueries({ queryKey: ['submissions', id] }) },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })
  if (isLoading) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>
  if (!data?.length) return <p className="p-8 text-center text-sm text-muted">{t('noAssessments')}</p>
  return (
    <div className="space-y-3 px-4 py-5 md:px-8">
      {data.map((s) => (
        <div key={s.id} className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold">{s.partnerName}</p>
            <span className="num text-xs text-muted">{formatDate(s.submittedAt, lang)}{s.late && ` · ${t('late')}`}</span>
          </div>
          {s.text && <p className="mt-2 whitespace-pre-wrap text-sm leading-6" dir="auto">{s.text}</p>}
          <Files files={s.files} />
          <div className="mt-3 grid gap-2 md:grid-cols-[120px_1fr_auto]">
            <input type="number" min={0} max={100} className="field h-10" placeholder={t('grade')} defaultValue={s.grade ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { grade: e.target.value, feedback: d[s.id]?.feedback ?? s.feedback ?? '' } }))} />
            <input className="field h-10" placeholder={t('feedback')} defaultValue={s.feedback ?? ''} dir="auto"
              onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { grade: d[s.id]?.grade ?? String(s.grade ?? ''), feedback: e.target.value } }))} />
            <button className="btn-primary h-10" onClick={() => grade.mutate(s)}><FileText className="h-4 w-4" />{t('gradeIt')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
