import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages serves project sites from /<repo>/. Override with BASE_PATH=/ for
// custom domains or local static serving.
//
// The trailing slash is enforced, not assumed. actions/configure-pages emits
// base_path WITHOUT one ("/ai-arxiv-reader"), and Vite passes base through to
// import.meta.env.BASE_URL verbatim, so `${BASE_URL}data/` silently became
// "/ai-arxiv-readerdata/" — a 404 for every index file, while Vite's own asset
// URLs kept working because it normalises those internally. The result was an
// app that loaded perfectly and could not find a single paper.
const rawBase = process.env.BASE_PATH?.trim() || '/ai-arxiv-reader/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

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
      // The SPA shell is precached and navigateFallback serves it offline, so
      // no separate offline page is needed.
      includeAssets: ['favicon.svg'],
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
            // The manifest MUST come before the /data/ rule below — Workbox
            // takes the first matching route.
            //
            // It is the one data file whose URL is stable while its contents
            // change every six hours, so serving it cache-first pinned every
            // returning reader to whichever build they happened to visit on,
            // for up to thirty days. The site refreshed on schedule and the
            // browser never noticed: an index that looked frozen while
            // everything upstream was healthy. Network-first fixes that and
            // still falls back to the cached copy when offline, which is all
            // the manifest was being cached for.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/manifest.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'corpus-manifest',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Everything else under /data/ is cache-first, which is what makes
            // offline search work. These files are NOT immutable — doc ids are
            // assigned newest-first, so every build renumbers the whole corpus
            // — but CorpusClient stamps each URL with the build it came from
            // (see versioned()), so each build occupies its own URL space and
            // a stale entry is never mixed into a fresh session's results.
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
