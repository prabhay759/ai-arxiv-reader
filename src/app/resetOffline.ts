/**
 * Tear down the offline layer and reload.
 *
 * The service worker caches the corpus so search works offline, which means it
 * can also hold on to a bad or outdated copy — and when it does, the app looks
 * broken on a site that is serving perfectly well. Reloading does not help,
 * because the worker answers the reload too. This is the escape hatch: drop
 * every cache, unregister the workers, and come back with a clean slate.
 *
 * Nothing the user owns is touched. Library, reading progress, highlights and
 * notes live in IndexedDB, which this deliberately leaves alone.
 */
export async function resetOfflineCaches(): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if ('caches' in window) {
    tasks.push(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    )
  }

  if ('serviceWorker' in navigator) {
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
    )
  }

  // Best effort: a failure here must still let the reload happen, or the user
  // is stuck on the very screen this is meant to clear.
  await Promise.allSettled(tasks)

  // Cache-busting param so the reload cannot be answered from the HTTP cache
  // either.
  const url = new URL(window.location.href)
  url.searchParams.set('fresh', Date.now().toString(36))
  window.location.replace(url.toString())
}
