import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../lib/api'

/** A campaign was tapped: count it, then open its link (a page in the app or an outside https link). */
export function GoScreen() {
  const { campaignId = '' } = useParams()
  const navigate = useNavigate()
  useEffect(() => {
    let alive = true
    api<{ url: string }>(`/api/campaigns/${campaignId}/open`, { method: 'POST' })
      .then(({ url }) => {
        if (!alive) return
        if (/^https:\/\//.test(url)) { window.location.replace(url); return }
        navigate(url.startsWith('/') && !url.startsWith('//') ? url : '/notifications', { replace: true })
      })
      .catch(() => alive && navigate('/notifications', { replace: true }))
    return () => { alive = false }
  }, [campaignId, navigate])
  return <div className="grid min-h-[60dvh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div>
}
