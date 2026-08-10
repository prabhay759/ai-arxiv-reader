import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages serves project sites from /<repo>/. Override with BASE_PATH=/ for
// custom domains or local static serving.
const base = process.env.BASE_PATH ?? '/ai-arxiv-reader/'

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'offline.html'],
      manifest: {
        name: 'arXiv AI Reader',
        short_name: 'arXiv Reader',
        description:
          'Search, read and resume AI papers from arXiv. Works offline, no installation.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The corpus shards are content-hashed by build time, never mutated in
        // place, so they are safe to cache aggressively.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/data\//, new RegExp(`^${base}data/`)],
        runtimeCaching: [
          {
            // Search index + metadata shards: cache-first, they are immutable
            // between deploys and this is what makes offline search work.
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'corpus-shards',
              expiration: { maxEntries: 900, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Paper bodies fetched live from arXiv: keep the last N read so
            // opened papers survive going offline.
            urlPattern: ({ url }) =>
              url.hostname === 'arxiv.org' &&
              (url.pathname.startsWith('/html/') || url.pathname.startsWith('/pdf/')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'arxiv-papers',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
