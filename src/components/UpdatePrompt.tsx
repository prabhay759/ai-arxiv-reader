import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Offers a reload when a new build is available, and confirms first-time
 * offline readiness. Prompting rather than auto-reloading matters here: a
 * silent refresh mid-paper would throw away the reader's scroll position.
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-edge bg-surface px-4 py-2 text-sm shadow-lg"
    >
      <span>{needRefresh ? 'A new version is available.' : 'Ready to use offline.'}</span>

      {needRefresh && (
        <button type="button" className="btn btn-primary px-2 py-1" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
      )}

      <button
        type="button"
        className="text-faint hover:text-ink"
        onClick={() => {
          setOfflineReady(false)
          setNeedRefresh(false)
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
