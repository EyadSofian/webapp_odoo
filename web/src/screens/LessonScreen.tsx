import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import clsx from 'clsx'
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { motion } from '../lib/motion'
import { ApiError, api, fetchBlobUrl } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { LessonDetail, LessonQuiz, LessonQuizResult } from '../lib/types'
import { ErrorState, Skeleton, TopBar, useToast } from '../components/ui'
import { lessonIcon } from './RecordedCourseScreen'

export function LessonScreen() {
  const { slideId } = useParams()
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lesson', slideId],
    queryFn: () => api<LessonDetail>(`/api/lessons/${slideId}`),
  })

  const complete = useMutation({
    mutationFn: () => api(`/api/lessons/${slideId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      toast({ kind: 'ok', text: t('markedDone') })
      void queryClient.invalidateQueries({ queryKey: ['lesson', slideId] })
      void queryClient.invalidateQueries({ queryKey: ['course', String(data?.channelId)] })
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
      void queryClient.invalidateQueries({ queryKey: ['home'] })
    },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })

  const file = useQuery({
    queryKey: ['lesson-file', slideId],
    queryFn: () => fetchBlobUrl(`/api/lessons/${slideId}/file`),
    enabled: !!data?.hasFile,
    staleTime: Infinity,
  })

  const html = useMemo(() => (data?.html ? DOMPurify.sanitize(data.html, { USE_PROFILES: { html: true } }) : null), [data?.html])
  const Icon = data ? lessonIcon(data.type) : null
  const quiz = data?.type === 'quiz' || data?.type === 'certification'

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-bg">
      <TopBar back={data ? `/recorded/${data.channelId}` : true} title={data?.title} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {isLoading && <div className="space-y-3 p-4"><Skeleton className="aspect-video w-full" /><Skeleton className="h-10 w-2/3" /></div>}

      {data && (
        <div className="flex-1 animate-fade-up">
          {data.videoEmbedUrl && (
            <div className="relative aspect-video w-full bg-black md:mt-4 md:overflow-hidden md:rounded-2xl">
              <iframe src={data.videoEmbedUrl} className="absolute inset-0 h-full w-full" title={data.title}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}

          <div className="space-y-4 px-4 py-4">
            <div className="flex items-start gap-3">
              {Icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-accent"><Icon className="h-5 w-5" /></span>}
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-bold leading-snug" dir="auto">{data.title}</h2>
                {data.minutes > 0 && <p className="num text-xs text-muted">{data.minutes} {t('minutes')}</p>}
              </div>
            </div>

            {html && <article className="prose-lesson card p-4" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />}

            {data.type === 'infographic' && file.data && <img src={file.data} alt={data.title} className="w-full rounded-2xl" />}

            {data.type === 'document' && (
              <div className="card p-4">
                {file.data && file.data.length > 0 && (
                  <object data={file.data} type="application/pdf" className="mb-3 hidden h-[70vh] w-full rounded-xl md:block">
                    <span />
                  </object>
                )}
                <div className="flex flex-wrap gap-2">
                  {data.documentUrl && <a className="btn-primary" href={data.documentUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{t('open')}</a>}
                  {file.data && <a className="btn-primary" href={file.data} download={`${data.title}.pdf`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />{t('download')}</a>}
                  {file.isLoading && <Skeleton className="h-11 w-32" />}
                </div>
              </div>
            )}

            {data.type === 'quiz' && <LessonQuizView slideId={data.id} channelId={data.channelId} />}
            {data.type === 'certification' && (
              <div className="card p-4">
                <p className="font-bold">{t('quizOnWebsite')}</p>
                {data.websiteUrl && <a className="btn-primary mt-3" href={data.websiteUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{t('openOnWebsite')}</a>}
              </div>
            )}
          </div>
        </div>
      )}

      {data && (
        <div className="sticky bottom-0 border-t border-line bg-surface/95 px-4 pb-[calc(12px+var(--safe-bottom))] pt-3 backdrop-blur">
          <div className="flex items-center gap-2">
            {data.previousLessonId
              ? <Link to={`/lessons/${data.previousLessonId}`} replace className="btn-ghost h-11 w-11 p-0" aria-label={t('previous')}><ChevronRight className="h-5 w-5 ltr:rotate-180" /></Link>
              : <span className="w-11" />}
            {!quiz && (
              <button className={data.completed ? 'btn-soft flex-1' : 'btn-primary flex-1'} onClick={() => complete.mutate()} disabled={data.completed || complete.isPending}>
                <Check className="h-5 w-5" />{data.completed ? t('completed') : t('markDone')}
              </button>
            )}
            {quiz && <span className="flex-1" />}
            {data.nextLessonId
              ? <Link to={`/lessons/${data.nextLessonId}`} replace className="btn-soft h-11 px-4">{lang === 'ar' ? 'التالي' : 'Next'}<ChevronLeft className="h-5 w-5 ltr:rotate-180" /></Link>
              : <span className="w-11" />}
          </div>
        </div>
      )}
    </div>
  )
}

/** Odoo's lesson quiz, answered in the app and graded on the server (the right answers never reach the browser). */
function LessonQuizView({ slideId, channelId }: { slideId: number; channelId: number }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const quiz = useQuery({ queryKey: ['lesson-quiz', slideId], queryFn: () => api<LessonQuiz>(`/api/lessons/${slideId}/quiz`) })
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<LessonQuizResult | null>(null)
  const submit = useMutation({
    mutationFn: () => api<LessonQuizResult>(`/api/lessons/${slideId}/quiz`, { method: 'POST', json: { answers } }),
    onSuccess: (r) => {
      setResult(r)
      toast({ kind: r.correct === r.total ? 'ok' : 'info', text: r.correct === r.total ? t('allCorrect') : t('someWrong') })
      void queryClient.invalidateQueries({ queryKey: ['course', String(channelId)] })
      void queryClient.invalidateQueries({ queryKey: ['lesson', String(slideId)] })
    },
    onError: (e) => toast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }),
  })
  if (quiz.isLoading) return <Skeleton className="h-64 w-full" />
  if (!quiz.data) return null
  const q = quiz.data
  return (
    <div className="space-y-3">
      {result && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={clsx('card flex items-center gap-3 p-4', result.correct === result.total ? 'ring-2 ring-ok/40' : 'ring-2 ring-warn/30')}>
          {result.correct === result.total ? <CheckCircle2 className="h-7 w-7 text-ok" /> : <XCircle className="h-7 w-7 text-warn" />}
          <p className="font-bold"><span className="num">{result.correct}/{result.total}</span> · {result.correct === result.total ? t('allCorrect') : t('someWrong')}</p>
        </motion.div>
      )}
      {q.questions.map((question, i) => {
        const r = result?.questions.find((x) => x.questionId === question.id)
        return (
          <div key={question.id} className="card p-4">
            <p className="mb-3 font-bold leading-7" dir="auto"><span className="num text-muted">{i + 1}. </span>{question.text}</p>
            <div className="grid gap-2">
              {question.answers.map((a, j) => {
                const chosen = answers[question.id] === a.id
                const judged = r && r.chosen === a.id
                return (
                  <button key={a.id} onClick={() => { setResult(null); setAnswers((x) => ({ ...x, [question.id]: a.id })) }}
                    className={clsx('flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-start text-[15px] transition',
                      judged ? (r!.isCorrect ? 'border-ok bg-ok/10' : 'border-live bg-live/10') : chosen ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-brand-200')}>
                    <span className={clsx('num grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', chosen ? 'bg-brand-500 text-white' : 'bg-sunken text-muted')}>{(lang === 'ar' ? 'أبجدهو' : 'ABCDEF')[j]}</span>
                    <span className="flex-1" dir="auto">{a.text}</span>
                  </button>
                )
              })}
            </div>
            {r?.comment && <p className="mt-2 rounded-xl bg-sunken p-3 text-sm" dir="auto">{r.comment}</p>}
          </div>
        )
      })}
      <button className="btn-primary h-12 w-full" disabled={submit.isPending || Object.keys(answers).length === 0} onClick={() => submit.mutate()}>
        {submit.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}{t('checkAnswers')}
      </button>
      {q.attempts > 0 && <p className="text-center text-xs text-muted"><span className="num">{q.attempts}</span> {lang === 'ar' ? 'محاولة سابقة' : 'previous attempts'}</p>}
    </div>
  )
}
