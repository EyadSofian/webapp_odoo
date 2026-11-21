/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 300: v('brand-300'), 400: v('brand-400'),
          500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900'),
        },
        accent: v('accent'),
        bg: v('bg'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        live: v('live'),
        ok: v('ok'),
        warn: v('warn'),
        gold: v('gold'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        latin: ['Manrope', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.06), 0 4px 16px -6px rgb(var(--shadow) / 0.12)',
        lift: '0 10px 30px -12px rgb(var(--shadow) / 0.35)',
        bar: '0 -1px 0 rgb(var(--line) / 1), 0 -8px 24px -12px rgb(var(--shadow) / 0.18)',
      },
      keyframes: {
        'live-ping': { '0%': { transform: 'scale(1)', opacity: '0.7' }, '80%,100%': { transform: 'scale(2.4)', opacity: '0' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(-100%)' } },
        'sheet-in': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
      },
      animation: {
        'live-ping': 'live-ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
        'fade-up': 'fade-up 280ms ease-out both',
        shimmer: 'shimmer 1.4s infinite',
        'sheet-in': 'sheet-in 260ms cubic-bezier(0.2,0.8,0.2,1) both',
      },
    },
  },
  plugins: [],
}
