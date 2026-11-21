import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const api = process.env.API_URL ?? 'http://localhost:5080'

// Shown in the profile, so support can tell which version a phone runs.
const build = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: true, type: 'module' },
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,webp,svg,woff2}'] },
      manifest: {
        id: '/',
        name: 'إنجوسوفت | منصة التعلّم',
        short_name: 'إنجوسوفت',
        description: 'دوراتك ومحاضراتك ومجموعات الدورات من إنجوسوفت في مكان واحد.',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F7FC',
        theme_color: '#F4F7FC',
        categories: ['education'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'المجموعات', url: '/chats', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'دوراتي', url: '/courses', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/hubs': { target: api, changeOrigin: true, ws: true },
      '/health': { target: api, changeOrigin: true },
    },
  },
  build: { target: 'es2020', sourcemap: true },
})
