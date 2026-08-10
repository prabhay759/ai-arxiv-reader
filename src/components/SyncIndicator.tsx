import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { SYNC_AVAILABLE } from '@/app/services'
import { useAppStore } from '@/app/store'
import { installSyncTriggers, runSync } from '@/sync'

/** Compact sync status in the header; full controls live in Settings. */
export function SyncIndicator() {
  const sync = useAppStore((s) => s.sync)

  useEffect(() => {
    if (!SYNC_AVAILABLE) return
    // Try a silent sync on load: a returning user with a live Google session
    // gets their data back without clicking anything.
    void runSync(false)
    return installSyncTriggers()
  }, [])

  if (!SYNC_AVAILABLE) return null

  if (sync.status === 'signed-out') {
    return (
      <Link to="/settings" className="ml-1 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-raised hover:text-ink">
        Sign in
      </Link>
    )
  }

  const label =
    sync.status === 'syncing'
      ? 'Syncing…'
      : sync.status === 'error'
        ? 'Sync problem'
        : 'Synced'

  return (
    <Link
      to="/settings"
      className="ml-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-raised"
      title={sync.status === 'error' ? sync.message : label}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          sync.status === 'error'
            ? 'bg-accent'
            : sync.status === 'syncing'
              ? 'animate-pulse bg-accent'
              : 'bg-emerald-500'
        }`}
      />
      <span className="sr-only">{label}</span>
      {'user' in sync && sync.user?.picture ? (
        <img src={sync.user.picture} alt="" className="h-5 w-5 rounded-full" />
      ) : null}
    </Link>
  )
}
