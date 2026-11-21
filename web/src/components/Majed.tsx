import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useI18n } from '../lib/i18n'

/**
 * Majed, Engosoft's learning advisor, rises from behind the login card and says hello.
 * Only his own artwork is used (no drawn limbs); the greeting is a small speech bubble.
 * He greets again every few seconds and when tapped or hovered. Reduced motion shows him still.
 */

type Phase = 'hidden' | 'peek' | 'hello'

export function Majed({ className, bubble = true, centered = false, nodKey = 0 }: { className?: string; bubble?: boolean; centered?: boolean; nodKey?: number }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(reduce ? 'peek' : 'hidden')
  const timers = useRef<number[]>([])
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }

  const hello = () => {
    if (reduce) return
    setPhase((p) => {
      if (p !== 'peek') return p
      later(2600, () => setPhase((q) => (q === 'hello' ? 'peek' : q)))
      return 'hello'
    })
  }

  useEffect(() => {
    if (reduce) return
    later(700, () => setPhase('peek'))
    later(1500, () => setPhase('hello'))
    later(4300, () => setPhase('peek'))
    const again = window.setInterval(hello, 10000)
    return () => { timers.current.forEach(clearTimeout); timers.current = []; clearInterval(again) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce])

  // Nods each time the page makes him "say" something.
  useEffect(() => {
    if (nodKey > 0) hello()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodKey])

  const up = phase !== 'hidden'
  const greeting = phase === 'hello'
  const width = centered ? 'w-[124px] left-1/2 -translate-x-1/2' : 'w-[220px]'

  return (
    <div className={`pointer-events-none absolute bottom-full z-20 h-[104px] ${width} ${className ?? ''}`}>
      {/* The clip's bottom is the card's top edge, so he rises from behind the card */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.button
          type="button"
          aria-label={t('majedHello')}
          tabIndex={-1}
          onClick={hello}
          onHoverStart={hello}
          className={`pointer-events-auto absolute top-0 origin-bottom cursor-pointer ${centered ? 'start-0 w-[124px]' : 'end-0 w-[112px]'}`}
          initial={false}
          animate={{ y: up ? (greeting ? [10, 2, 10, 4, 10] : 10) : 124, rotate: greeting ? [0, -6, 5, -4, 0] : 0 }}
          transition={up
            ? { y: greeting ? { duration: 1.4, ease: 'easeInOut' } : { type: 'spring', stiffness: 220, damping: 18 }, rotate: { duration: 1.4, ease: 'easeInOut' } }
            : { duration: 0.3 }}
        >
          <img src="/art/majed.webp" alt="" width={112} height={118} className="block h-auto w-full select-none" draggable={false} />
        </motion.button>
      </div>

      {/* Speech bubble next to his head */}
      <AnimatePresence>
        {bubble && greeting && (
          <motion.div
            className="absolute end-[104px] top-1 rounded-[14px] border border-line bg-surface px-3 py-2 text-[13px] font-medium leading-5 text-ink shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="whitespace-nowrap">{t('majedHello')}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
