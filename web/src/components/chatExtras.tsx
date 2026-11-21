import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Mic, Pause, Play, SendHorizonal, Trash2 } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import type { MemberDto } from '../lib/types'
import { Avatar, RoleBadge, useAuthedImage } from './ui'

// ------------------------------------------------------------------ helpers

export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Message text with @mentions of group members highlighted and links clickable. */
export function RichBody({ text, names, myName, mine }: { text: string; names: string[]; myName: string; mine: boolean }) {
  const parts = useMemo(() => {
    const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length)
    const mention = sorted.length ? new RegExp(`(@(?:${sorted.map(escapeRe).join('|')}))`, 'g') : null
    const out: ReactNode[] = []
    const chunks = mention ? text.split(mention) : [text]
    chunks.forEach((chunk, i) => {
      if (mention && i % 2 === 1) {
        const isMe = chunk.slice(1) === myName
        out.push(
          <span key={`m${i}`} className={clsx('rounded-[6px] px-1 font-semibold',
            mine ? 'bg-white/20 text-white' : isMe ? 'bg-brand-500 text-white' : 'bg-brand-50 text-accent')}>{chunk}</span>,
        )
        return
      }
      chunk.split(/(https?:\/\/[^\s]+)/g).forEach((p, j) => {
        out.push(/^https?:\/\//.test(p)
          ? <a key={`l${i}-${j}`} href={p} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2" dir="ltr">{p}</a>
          : p)
      })
    })
    return out
  }, [text, names, myName, mine])
  return <>{parts}</>
}

// ------------------------------------------------------------------ mentions

/** The "@query" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before)
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null
}

export function MentionList({ items, active, onPick }: { items: MemberDto[]; active: number; onPick: (m: MemberDto) => void }) {
  if (items.length === 0) return null
  return (
    <div className="absolute inset-x-2 bottom-full mb-2 overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_12px_32px_-12px_rgb(var(--shadow)/0.35)]" role="listbox">
      {items.map((m, i) => (
        <button key={m.partnerId} type="button" role="option" aria-selected={i === active}
          onMouseDown={(e) => { e.preventDefault(); onPick(m) }}
          className={clsx('flex w-full items-center gap-3 px-3 py-2 text-start transition-colors', i === active ? 'bg-sunken' : 'hover:bg-sunken')}>
          <Avatar partnerId={m.partnerId} name={m.name} size={28} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{m.name}</span>
          <RoleBadge role={m.role} />
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ voice recording

const pickMime = () => {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) ?? ''
}

export const MAX_VOICE_SECONDS = 300

/**
 * Records a voice note while mounted. Shows a live level meter and a timer; the trash button discards,
 * the send button stops and hands the file back. Stops on its own at five minutes.
 */
export function VoiceRecorder({ onCancel, onDone, onError }: { onCancel: () => void; onDone: (file: File, seconds: number) => void; onError: (msg: string) => void }) {
  const { t } = useI18n()
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0.08))
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const stream = useRef<MediaStream | null>(null)
  const started = useRef(0)
  const sendOnStop = useRef(false)
  const raf = useRef(0)

  useEffect(() => {
    let ctx: AudioContext | null = null
    let cancelled = false
    ;(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        if (cancelled) { s.getTracks().forEach((x) => x.stop()); return }
        stream.current = s
        const mime = pickMime()
        const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined)
        rec.current = r
        r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
        r.onstop = () => {
          s.getTracks().forEach((x) => x.stop())
          if (!sendOnStop.current) return
          const type = r.mimeType || mime || 'audio/webm'
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          const blob = new Blob(chunks.current, { type: type.split(';')[0] })
          const secs = (performance.now() - started.current) / 1000
          if (secs < 0.8 || blob.size < 1200) { onCancel(); return }
          onDone(new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: blob.type }), secs)
        }
        r.start(250)
        started.current = performance.now()

        // Live level meter
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        ctx.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        let last = 0
        const tick = (now: number) => {
          raf.current = requestAnimationFrame(tick)
          setSeconds((now - started.current) / 1000)
          if (now - last < 90) return
          last = now
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
          setLevels((l) => [...l.slice(1), Math.min(1, 0.08 + peak * 1.6)])
          if ((now - started.current) / 1000 >= MAX_VOICE_SECONDS) finish(true)
        }
        raf.current = requestAnimationFrame(tick)
      } catch {
        onError(t('micBlocked'))
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf.current)
      if (rec.current?.state === 'recording') { sendOnStop.current = false; rec.current.stop() }
      stream.current?.getTracks().forEach((x) => x.stop())
      void ctx?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (send: boolean) => {
    cancelAnimationFrame(raf.current)
    sendOnStop.current = send
    if (rec.current?.state === 'recording') rec.current.stop()
    if (!send) onCancel()
  }

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-live transition-colors hover:bg-live/10" onClick={() => finish(false)} aria-label={t('delete')}>
        <Trash2 className="h-5 w-5" />
      </button>
      <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full bg-sunken px-4">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 animate-live-ping rounded-full bg-live" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-live" />
        </span>
        <span className="num w-10 shrink-0 text-[14px] font-semibold tabular-nums">{clock(seconds)}</span>
        <span className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" dir="ltr" aria-hidden>
          {levels.map((v, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-accent/70" style={{ height: `${Math.max(12, v * 100)}%` }} />)}
        </span>
      </div>
      <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-white transition-[background-color,transform] hover:bg-brand-600 active:scale-95"
        onClick={() => finish(true)} aria-label={t('send')}>
        <SendHorizonal className="h-5 w-5 rtl:rotate-180" />
      </button>
    </div>
  )
}

export function MicButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-white transition-[background-color,transform] hover:bg-brand-600 active:scale-95"
      onClick={onClick} aria-label={label}>
      <Mic className="h-5 w-5" />
    </button>
  )
}

// ------------------------------------------------------------------ voice playback

/** Waveform from the actual audio when the browser can decode it; a steady pattern otherwise. */
function useWaveform(url: string | undefined, seed: string, bars = 36) {
  const [peaks, setPeaks] = useState<number[]>(() => {
    let h = 0
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return Array.from({ length: bars }, (_, i) => 0.25 + (((h >> (i % 24)) ^ (i * 2654435761)) >>> 0) % 70 / 100)
  })
  useEffect(() => {
    if (!url) return
    let alive = true
    ;(async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer()
        const ctx = new AudioContext()
        const audio = await ctx.decodeAudioData(buf)
        void ctx.close()
        const ch = audio.getChannelData(0)
        const step = Math.floor(ch.length / bars) || 1
        const out: number[] = []
        for (let b = 0; b < bars; b++) {
          let peak = 0
          for (let i = b * step; i < Math.min(ch.length, (b + 1) * step); i += 16) peak = Math.max(peak, Math.abs(ch[i]))
          out.push(peak)
        }
        const max = Math.max(...out, 0.01)
        if (alive) setPeaks(out.map((p) => 0.15 + 0.85 * (p / max)))
      } catch { /* keep the steady pattern */ }
    })()
    return () => { alive = false }
  }, [url, bars])
  return peaks
}

export function VoicePlayer({ id, mine }: { id: string; mine: boolean }) {
  const url = useAuthedImage(`/api/chats/attachments/${id}`)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const peaks = useWaveform(url, id)
  const progress = duration ? time / duration : 0

  const onMeta = () => {
    const a = audio.current
    if (!a) return
    // Chrome reports Infinity for recorded webm until it has scanned the file once.
    if (!Number.isFinite(a.duration)) {
      a.currentTime = 1e7
      a.addEventListener('timeupdate', function fix() { a.removeEventListener('timeupdate', fix); setDuration(a.duration); a.currentTime = 0 }, { once: true })
    } else setDuration(a.duration)
  }

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) { document.querySelectorAll('audio').forEach((x) => { if (x !== a) x.pause() }); void a.play() } else a.pause()
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current
    if (!a || !duration) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - r.left) / r.width) * duration
  }

  return (
    <div className="mb-1 flex w-[240px] max-w-full items-center gap-2.5" dir="ltr">
      <button type="button" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Play'}
        className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform active:scale-95 disabled:opacity-50',
          mine ? 'bg-white text-brand-600' : 'bg-brand-500 text-white')}>
        {playing ? <Pause className="h-[18px] w-[18px]" fill="currentColor" /> : <Play className="ms-0.5 h-[18px] w-[18px]" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 cursor-pointer items-center gap-[2px]" onClick={seek}>
          {peaks.map((p, i) => (
            <span key={i} className={clsx('w-[3px] flex-1 rounded-full transition-colors',
              i / peaks.length < progress ? (mine ? 'bg-white' : 'bg-accent') : (mine ? 'bg-white/40' : 'bg-muted/40'))}
              style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
        </div>
        <span className={clsx('num text-[11px]', mine ? 'text-white/80' : 'text-muted')}>{clock(playing || time ? time : duration)}</span>
      </div>
      {url && (
        <audio ref={audio} src={url} preload="metadata" onLoadedMetadata={onMeta}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0) }} />
      )}
    </div>
  )
}
