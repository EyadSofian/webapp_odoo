import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

// One count per campaign per app session, however often this screen mounts.
const opened = new Map<string, Promise<{ url: string }>>()

/**
 * A campaign was tapped: count it, then open its link. A page inside the app opens directly. An outside link gets a
 * button instead of replacing the app: on iPhone the installed app shows outside pages in a sheet on top of itself,
 * and coming back from that sheet to a screen that redirects again sent people out over and over.
 */
export function GoScreen() {
  const { campaignId = '' } = useParams()
  const navigate = useNavigate()
  const { lang } = useI18n()
  const [external, setExternal] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!opened.has(campaignId)) opened.set(campaignId, api<{ url: string }>(`/api/campaigns/${campaignId}/open`, { method: 'POST' }))
    opened.get(campaignId)!
      .then(({ url }) => {
        if (!alive) return
        if (/^https:\/\//.test(url)) { setExternal(url); return }
        navigate(url.startsWith('/') && !url.startsWith('//') ? url : '/notifications', { replace: true })
      })
      .catch(() => {
        opened.delete(campaignId)
        if (alive) navigate('/notifications', { replace: true })
      })
    return () => { alive = false }
  }, [campaignId, navigate])

  if (!external) return <div className="grid min-h-[60dvh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div>

  const host = (() => { try { return new URL(external).host } catch { return external } })()
  return (
    <div className="mx-auto grid min-h-[60dvh] max-w-sm place-items-center px-6">
      <div className="w-full text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-accent"><ExternalLink className="h-6 w-6" /></span>
        <h1 className="font-display text-lg font-bold">{lang === 'ar' ? 'الرابط على موقع خارج التطبيق' : 'This link opens outside the app'}</h1>
        <p className="num mt-1 text-sm text-muted" dir="ltr">{host}</p>
        <a href={external} target="_blank" rel="noopener noreferrer" className="btn-primary mt-6 w-full"
          onClick={() => window.setTimeout(() => navigate('/notifications', { replace: true }), 300)}>
          {lang === 'ar' ? 'افتح الرابط' : 'Open link'}
        </a>
        <Link to="/notifications" replace className="btn-ghost mt-2 w-full">{lang === 'ar' ? 'رجوع' : 'Back'}</Link>
      </div>
    </div>
  )
}
