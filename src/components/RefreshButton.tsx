import { useEffect, useRef, useState } from 'react'
import { corpus, DATA_BASE_URL } from '@/app/services'
import type { Manifest } from '@/search/corpus'

type State = 'idle' | 'checking' | 'current' | 'updating' | 'failed'

/** How long "Up to date" stays on screen before the button goes quiet again. */
const MESSAGE_MS = 4000

/** Give up waiting for a newly downloaded worker to finish installing. */
const INSTALL_TIMEOUT_MS = 15_000

/**
 * Pull the newest index on demand.
 *
 * The corpus rebuilds every six hours in CI, but nothing tells an open tab
 * that: the app reads the manifest once at startup, and the service worker
 * keeps serving whatever it has. This is the manual pull — check whether a
 * newer build exists and, if it does, come back on it.
 *
 * It deliberately does not clear offline data. That escape hatch already
 * exists in Settings; it drops the whole cached corpus and every paper saved
 * for offline reading, which is far too much to spend on "is there anything
 * new?".
 */
export function RefreshButton() {
  const [state, setState] = useState<State>('idle')
  const [builtAt, setBuiltAt] = useState<string>()
  const timer = useRef<number>()

  useEffect(() => {
    corpus
      .manifest()
      .then((manifest) => setBuiltAt(manifest.builtAt))
      .catch(() => undefined)
    return () => window.clearTimeout(timer.current)
  }, [])

  async function refresh() {
    window.clearTimeout(timer.current)
    setState('checking')

    try {
      // New app code first. If a newer build of the app itself is waiting, it
      // supersedes everything below — including, on an older build, the
      // cache-first rule that caused stale indexes in the first place.
      if (await activateWaitingWorker()) {
        setState('updating')
        return
      }

      if (await indexHasMoved()) {
        setState('updating')
        window.location.reload()
        return
      }

      setState('current')
    } catch {
      setState('failed')
    }

    // 'updating' is deliberately excluded: that state ends in a reload, and
    // clearing it first would flash the idle button on the way out.
    timer.current = window.setTimeout(() => setState('idle'), MESSAGE_MS)
  }

  const busy = state === 'checking' || state === 'updating'
  const message = MESSAGES[state]

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
      {/* One live region, always mounted so screen readers pick up changes to
          it, and carrying the visible text rather than a parallel copy — two
          wordings of the same outcome is one to keep in sync and one to get
          announced twice. */}
      <span role="status" aria-live="polite">
        {message && (
          <span
            className={`rounded-full border border-edge bg-surface px-3 py-1.5 text-xs shadow-lg ${
              state === 'failed' ? 'text-accent' : 'text-muted'
            }`}
          >
            {message}
          </span>
        )}
      </span>

      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        title={
          builtAt
            ? `Index built ${new Date(builtAt).toLocaleString()} — check for newer papers`
            : 'Check for newer papers'
        }
        aria-label="Check for newer papers"
        className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-2 text-xs font-medium shadow-lg transition-colors hover:bg-raised disabled:opacity-70"
      >
        <RefreshIcon spinning={busy} />
        <span className="hidden sm:inline">
          {state === 'checking' ? 'Checking…' : state === 'updating' ? 'Updating…' : 'Refresh'}
        </span>
      </button>
    </div>
  )
}

const MESSAGES: Record<State, string> = {
  idle: '',
  checking: '',
  current: 'Already up to date',
  updating: 'Newer index found — reloading',
  failed: 'Could not reach the index',
}

/**
 * Whether the deployed index is a different build from the one this session
 * loaded.
 *
 * The request is cache-busted rather than merely revalidated. `cache: 'reload'`
 * only bypasses the HTTP cache — a service worker still answers it from its
 * own store, and an older build of this app cached the manifest first-from-
 * cache for thirty days. A URL the worker has never seen is the one request it
 * cannot serve staleley, which is exactly the situation this button has to be
 * able to dig a reader out of.
 */
async function indexHasMoved(): Promise<boolean> {
  let loaded: string | undefined
  try {
    loaded = (await corpus.manifest()).builtAt
  } catch {
    // The session never got a usable manifest, so reloading can only help.
    return true
  }

  const response = await fetch(
    `${DATA_BASE_URL}manifest.json?t=${Date.now().toString(36)}`,
    { cache: 'reload' }
  )
  if (!response.ok) throw new Error(`manifest returned HTTP ${response.status}`)

  const latest = (await response.json()) as Manifest
  return latest.builtAt !== loaded
}

/**
 * Activate a newer build of the app if one is waiting, and reload onto it.
 *
 * Returns true when a reload is under way, so the caller stops rather than
 * racing it with a second one.
 */
async function activateWaitingWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false

  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return false

  // Browsers only look for a new worker on their own schedule, so a tab left
  // open can sit on an old build indefinitely. Ask explicitly.
  await registration.update().catch(() => undefined)

  const waiting = await waitingWorker(registration)
  if (!waiting) return false

  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => window.location.reload(),
    { once: true }
  )
  waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

/** The waiting worker, allowing for one that is still installing. */
function waitingWorker(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorker | null> {
  if (registration.waiting) return Promise.resolve(registration.waiting)

  const installing = registration.installing
  if (!installing) return Promise.resolve(null)

  return new Promise((resolve) => {
    const done = (worker: ServiceWorker | null) => {
      window.clearTimeout(timeout)
      installing.removeEventListener('statechange', onStateChange)
      resolve(worker)
    }
    // A download that stalls must not leave the button spinning forever.
    const timeout = window.setTimeout(() => done(null), INSTALL_TIMEOUT_MS)
    const onStateChange = () => {
      if (installing.state === 'installed') done(registration.waiting ?? null)
      else if (installing.state === 'redundant') done(null)
    }
    installing.addEventListener('statechange', onStateChange)
  })
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 11.5a8 8 0 1 0-.6 3.5" />
      <path d="M20 20v-5h-5" />
    </svg>
  )
}
