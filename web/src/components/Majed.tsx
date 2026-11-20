import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Majed, Engosoft's learning advisor, peeks over the top edge of the login card,
 * holds on with both hands, and waves. Tap him (or hover on desktop) to wave again.
 * The image is the head and shoulders only, so the hands are drawn here in his skin tone.
 */

const SKIN = '#ca8563'
const SKIN_SHADE = '#b5694a'
const SKIN_LINE = '#9a5236'
const SLEEVE = '#f4f2f2'
const SLEEVE_SHADE = '#d5d0d0'

type Phase = 'hidden' | 'peek' | 'wave'

/** Four fingers curled over the card edge. */
function GripHand({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 30 20" className="h-[20px] w-[30px]" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden>
      {[1, 8, 15, 22].map((x, i) => (
        <g key={x}>
          <rect x={x} y={i === 0 || i === 3 ? 3 : 1} width="7" height={i === 0 || i === 3 ? 15 : 17} rx="3.5" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.8" />
          <rect x={x + 1.6} y={i === 0 || i === 3 ? 13 : 13} width="3.8" height="3.4" rx="1.6" fill={SKIN_SHADE} opacity="0.55" />
        </g>
      ))}
    </svg>
  )
}

/** Open hand on a white thobe sleeve, drawn upright; it rotates around the bottom of the sleeve. */
function WaveArm() {
  return (
    <svg viewBox="0 0 40 84" className="h-[84px] w-[40px]" aria-hidden>
      <rect x="9" y="42" width="22" height="42" rx="9" fill={SLEEVE} stroke={SLEEVE_SHADE} strokeWidth="1" />
      <rect x="9" y="42" width="22" height="7" rx="3.5" fill={SLEEVE_SHADE} opacity="0.6" />
      <ellipse cx="8.5" cy="30" rx="4.2" ry="7.5" transform="rotate(-32 8.5 30)" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.8" />
      {[
        { x: 10, y: 8, h: 22 },
        { x: 16, y: 4, h: 26 },
        { x: 22, y: 5, h: 25 },
        { x: 28, y: 10, h: 20 },
      ].map((f) => (
        <rect key={f.x} x={f.x - 0.5} y={f.y} width="6" height={f.h} rx="3" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.8" />
      ))}
      <rect x="9" y="20" width="25" height="24" rx="10" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.8" />
      <path d="M13 31c4 3 10 3 15 0" fill="none" stroke={SKIN_SHADE} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function Majed({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(reduce ? 'peek' : 'hidden')
  const timers = useRef<number[]>([])

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }

  const wave = () => {
    if (reduce || phase === 'wave' || phase === 'hidden') return
    setPhase('wave')
    later(2100, () => setPhase('peek'))
  }

  useEffect(() => {
    if (reduce) return
    later(900, () => setPhase('peek'))
    later(1900, () => setPhase('wave'))
    later(4000, () => setPhase('peek'))
    const again = window.setInterval(() => {
      setPhase((p) => (p === 'peek' ? 'wave' : p))
      later(2100, () => setPhase((p) => (p === 'wave' ? 'peek' : p)))
    }, 9000)
    return () => { timers.current.forEach(clearTimeout); timers.current = []; clearInterval(again) }
  }, [reduce])

  const up = phase !== 'hidden'
  const waving = phase === 'wave'
  const spring = { type: 'spring' as const, stiffness: 240, damping: 17, mass: 0.9 }

  return (
    <div className={`pointer-events-none absolute bottom-full z-20 h-[92px] w-[176px] ${className ?? ''}`}>
      {/* Everything that rises from behind the card lives in this clip, whose bottom is the card's top edge */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Waving arm, behind his shoulder */}
        <motion.div
          className="absolute end-[26px] bottom-0 origin-bottom"
          initial={false}
          animate={waving ? { y: 6, rotate: [0, -22, 16, -22, 16, -10, 0] } : { y: 96, rotate: 0 }}
          transition={waving ? { y: spring, rotate: { duration: 1.8, ease: 'easeInOut', delay: 0.15 } } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="ltr:scale-x-[-1]"><WaveArm /></div>
        </motion.div>
        <motion.button
          type="button"
          aria-label="Majed"
          tabIndex={-1}
          onClick={wave}
          onHoverStart={wave}
          className="pointer-events-auto absolute start-[28px] top-0 w-[112px] cursor-pointer"
          initial={false}
          animate={{
            y: up ? (waving ? [9, 5, 9] : 9) : 124,
            rotate: waving ? [0, -3, 2, -3, 0] : 0,
          }}
          transition={up ? { y: waving ? { duration: 1, repeat: 1 } : spring, rotate: { duration: 2, ease: 'easeInOut' } } : { duration: 0.3 }}
        >
          <img src="/art/majed.webp" alt="" width={112} height={118} className="block h-auto w-full select-none drop-shadow-[0_6px_10px_rgb(0_0_0/0.35)]" draggable={false} />
        </motion.button>

      </div>

      {/* Hands holding the edge, in front of the card */}
      <motion.div className="absolute start-[22px] top-full -translate-y-[11px]" initial={false}
        animate={{ opacity: up ? 1 : 0, y: up ? 0 : 8 }} transition={{ duration: 0.25, delay: up ? 0.18 : 0 }}>
        <GripHand />
      </motion.div>
      <motion.div className="absolute start-[116px] top-full -translate-y-[11px]" initial={false}
        animate={{ opacity: up && !waving ? 1 : 0, y: up && !waving ? 0 : 8 }} transition={{ duration: 0.2, delay: up && !waving ? 0.2 : 0 }}>
        <GripHand flip />
      </motion.div>
    </div>
  )
}
