import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'engosoft.theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Puts the resolved theme on <html data-theme>, which the CSS variables and Tailwind's `dark:` follow. */
function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  setBarColor()
}

/**
 * The phone's status and navigation bars take this color. They match the page background, so the app has no
 * colored frame; only while the launch splash is up do they stay Engosoft blue (index.html calls this when it leaves).
 */
function setBarColor() {
  if (document.getElementById('splash')) return
  const dark = document.documentElement.dataset.theme === 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#060914' : '#F3F4F7')
}
if (typeof window !== 'undefined') (window as unknown as { setBarColor?: () => void }).setBarColor = setBarColor

let choice: ThemeChoice = typeof window === 'undefined' ? 'system' : readChoice()
const listeners = new Set<(c: ThemeChoice) => void>()

if (typeof window !== 'undefined') {
  apply(choice)
  media().addEventListener('change', () => { if (choice === 'system') apply('system') })
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    choice = readChoice()
    apply(choice)
    listeners.forEach((l) => l(choice))
  })
}

export function setTheme(next: ThemeChoice) {
  choice = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* private mode: applies for this visit only */
  }
  apply(next)
  listeners.forEach((l) => l(next))
}

export function useTheme() {
  const [value, setValue] = useState<ThemeChoice>(choice)
  useEffect(() => {
    listeners.add(setValue)
    return () => { listeners.delete(setValue) }
  }, [])
  const resolved: 'light' | 'dark' =
    value === 'dark' || (value === 'system' && typeof window !== 'undefined' && media().matches) ? 'dark' : 'light'
  return { theme: value, resolved, setTheme }
}
