import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'framer-motion'

/** Native scrolling (no inertia library, no custom cursor): instant on every device. Scrolls to the top on each new screen. */
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

/** Cross-fade between screens. */
export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey?: string }) {
  const { pathname } = useLocation()
  const key = routeKey ?? pathname
  const r = useReducedMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={r ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={r ? undefined : { opacity: 0, y: -6 }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** Rises into place the first time it scrolls into view. Content is visible without JS-driven motion when reduced. */
export function Reveal({ children, delay = 0, className, y = 18 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const r = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={r ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Lists that cascade in, one item after another. */
export function Stagger({ children, className, gap = 0.05 }: { children: ReactNode; className?: string; gap?: number }) {
  const r = useReducedMotion()
  return (
    <motion.div className={className} initial={r ? false : 'hidden'} whileInView="show" viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] } } }}>
      {children}
    </motion.div>
  )
}

/** Counts up to a number when it comes into view. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const r = useReducedMotion()
  useEffect(() => {
    if (!inView || !ref.current) return
    if (r) { ref.current.textContent = String(value); return }
    const controls = animate(0, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => { if (ref.current) ref.current.textContent = String(Math.round(v)) } })
    return () => controls.stop()
  }, [inView, value, r])
  return <span ref={ref} className={className}>0</span>
}

export { motion, AnimatePresence }
