import { useRef, useState } from 'react'
import type { ThemePreference } from '@/types'
import { SYNC_AVAILABLE } from '@/app/services'
import { useAppStore } from '@/app/store'
import { relativeDate, toBibTeX } from '@/app/format'
import { IndexStatus } from '@/components/IndexStatus'
import { clearLocalData, db, localDataCount } from '@/store/db'
import { clearSearchHistory } from '@/store/library'
import { exportLocal, importLocal, runSync, stopSync } from '@/sync'
import { mergeDocuments } from '@/sync/merge'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export default function Settings() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const sync = useAppStore((s) => s.sync)
  const [message, setMessage] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)

  async function downloadExport(format: 'json' | 'bibtex') {
    const doc = await exportLocal()

    let blob: Blob
    let filename: string

    if (format === 'json') {
      blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      filename = 'arxiv-reader-library.json'
    } else {
      const papers = await db.papers.bulkGet(doc.library.filter((e) => !e.deleted).map((e) => e.paperId))
      const entries = papers.filter(Boolean).map((paper) => toBibTeX(paper!))
      blob = new Blob([entries.join('\n\n')], { type: 'application/x-bibtex' })
      filename = 'arxiv-reader-library.bib'
    }

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(file: File) {
    try {
      const incoming = JSON.parse(await file.text())
      if (incoming?.schema !== 1) throw new Error('Not an arXiv Reader export.')

      // Merge rather than replace, so importing on a device that already has
      // data adds to it instead of wiping it.
      const merged = mergeDocuments(await exportLocal(), incoming)
      await importLocal(merged)
      setMessage('Library imported.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="mb-2 text-sm font-semibold">
          Appearance
        </h2>
        <div className="flex gap-1">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              aria-pressed={theme === option.value}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                theme === option.value
                  ? 'bg-accent text-accent-ink'
                  : 'bg-raised text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="sync-heading">
        <h2 id="sync-heading" className="mb-2 text-sm font-semibold">
          Sync across devices
        </h2>

        {!SYNC_AVAILABLE ? (
          <div className="card p-4 text-sm text-muted">
            <p>
              Google sign-in isn&rsquo;t configured for this deployment, so everything is stored
              on this device only. Your library, progress, highlights and notes all work
              normally — they just won&rsquo;t follow you to another browser.
            </p>
            <p className="mt-2">
              To enable it, create a free Google OAuth client id, set it as the{' '}
              <code className="font-mono text-xs">VITE_GOOGLE_CLIENT_ID</code> repository
              variable, and redeploy. The client id is a public identifier, not a secret.
            </p>
            <p className="mt-2">
              <a
                className="underline hover:text-ink"
                href="https://github.com/prabhay759/ai-arxiv-reader#enable-google-sign-in"
                target="_blank"
                rel="noreferrer"
              >
                Step-by-step setup guide →
              </a>
            </p>
            <p className="mt-2 text-xs text-faint">
              Whichever origin you serve the app from must be listed under &ldquo;Authorised
              JavaScript origins&rdquo; on the OAuth client, exactly — including the port. This
              site&rsquo;s origin is{' '}
              <code className="font-mono">{window.location.origin}</code>.
            </p>
          </div>
        ) : (
          <div className="card space-y-3 p-4">
            <p className="text-sm text-muted">
              Signing in with Google stores a single sync file in your own Google Drive, in a
              hidden app folder only this app can read. There is no server and no account —
              your data stays yours, and revoking access in your Google account removes it.
            </p>

            {sync.status === 'signed-out' && (
              <button type="button" className="btn btn-primary" onClick={() => void runSync(true)}>
                Sign in with Google
              </button>
            )}

            {sync.status === 'syncing' && <p className="text-sm">Syncing…</p>}

            {sync.status === 'idle' && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">
                  Signed in as <strong>{sync.user.email}</strong> · synced{' '}
                  {relativeDate(sync.lastSyncAt)}
                </p>
                <button type="button" className="btn" onClick={() => void runSync(true)}>
                  Sync now
                </button>
                <button type="button" className="btn" onClick={stopSync}>
                  Sign out
                </button>
              </div>
            )}

            {sync.status === 'error' && (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-ink">{sync.message}</p>
                <button type="button" className="btn" onClick={() => void runSync(true)}>
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="data-heading">
        <h2 id="data-heading" className="mb-2 text-sm font-semibold">
          Your data
        </h2>
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => void downloadExport('json')}>
              Export library (JSON)
            </button>
            <button type="button" className="btn" onClick={() => void downloadExport('bibtex')}>
              Export BibTeX
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
                event.target.value = ''
              }}
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-edge pt-3">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void clearSearchHistory()
                setMessage('Search history cleared.')
              }}
            >
              Clear search history
            </button>
            <button
              type="button"
              className="btn text-accent"
              onClick={async () => {
                const count = await localDataCount()
                if (
                  window.confirm(
                    `Delete all ${count} local records — library, progress, highlights and notes?` +
                      (sync.status === 'idle'
                        ? '\n\nThis only clears this device. Your Drive copy is untouched, and the next sync will restore it.'
                        : '\n\nThis cannot be undone.')
                  )
                ) {
                  await clearLocalData()
                  setMessage('Local data cleared.')
                }
              }}
            >
              Clear local data
            </button>
          </div>

          {message && (
            <p role="status" className="text-sm text-muted">
              {message}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="index-heading">
        <h2 id="index-heading" className="mb-2 text-sm font-semibold">
          Search index
        </h2>
        <div className="card p-4">
          <IndexStatus />
        </div>
      </section>

      <section aria-labelledby="about-heading">
        <h2 id="about-heading" className="mb-2 text-sm font-semibold">
          About
        </h2>
        <p className="text-sm text-muted">
          Paper metadata is harvested from arXiv&rsquo;s OAI-PMH interface and served as a static
          search index; full text is loaded directly from arXiv. No tracking, no analytics, no
          server.
        </p>
      </section>
    </div>
  )
}
