import { useState } from 'react'
import { resetOfflineCaches } from '@/app/resetOffline'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="card px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  )
}

export function ErrorNote({
  message,
  onRetry,
  offerOfflineReset = false,
}: {
  message: string
  onRetry?: () => void
  /**
   * Show the "clear offline data" escape hatch. Worth offering whenever the
   * failure could be a stale service-worker cache rather than the site being
   * down — reloading alone cannot fix that, because the worker answers the
   * reload too.
   */
  offerOfflineReset?: boolean
}) {
  const [resetting, setResetting] = useState(false)

  return (
    <div role="alert" className="card border-accent/40 bg-accent/5 p-4 text-sm">
      <p className="text-ink">{message}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        )}
        {offerOfflineReset && (
          <button
            type="button"
            className="btn"
            disabled={resetting}
            onClick={() => {
              setResetting(true)
              void resetOfflineCaches()
            }}
          >
            {resetting ? 'Clearing…' : 'Clear offline data and reload'}
          </button>
        )}
      </div>

      {offerOfflineReset && (
        <p className="mt-2 text-xs text-faint">
          Clearing removes only the cached copy of the paper index. Your library,
          reading progress, highlights and notes stay on this device.
        </p>
      )}
    </div>
  )
}
