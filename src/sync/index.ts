import type { SyncDocument } from '@/types'
import { db, readSettings } from '@/store/db'
import { useAppStore } from '@/app/store'
import { SYNC_AVAILABLE } from '@/app/services'
import { ReauthRequiredError, getAccessToken, fetchUserInfo, signOut } from './auth'
import { ConcurrentWriteError, readRemote, writeRemote } from './drive'
import { EMPTY_SYNC_DOCUMENT, mergeDocuments, normalizeDocument, pruneTombstones } from './merge'

/** Snapshot everything syncable out of IndexedDB. */
export async function exportLocal(): Promise<SyncDocument> {
  const [progress, library, collections, highlights, notes, savedSearches, readingUnits, settings] =
    await Promise.all([
      db.progress.toArray(),
      db.library.toArray(),
      db.collections.toArray(),
      db.highlights.toArray(),
      db.notes.toArray(),
      db.savedSearches.toArray(),
      db.readingUnits.toArray(),
      readSettings(),
    ])

  return {
    schema: 1,
    updatedAt: Date.now(),
    progress,
    library,
    collections,
    highlights,
    notes,
    savedSearches,
    readingUnits,
    settings,
  }
}

/** Write a merged document back into IndexedDB, replacing local state. */
export async function importLocal(incoming: Partial<SyncDocument>): Promise<void> {
  const doc = normalizeDocument(incoming)
  await db.transaction(
    'rw',
    [
      db.progress,
      db.library,
      db.collections,
      db.highlights,
      db.notes,
      db.savedSearches,
      db.readingUnits,
    ],
    async () => {
      await Promise.all([
        db.progress.bulkPut(doc.progress),
        db.library.bulkPut(doc.library),
        db.collections.bulkPut(doc.collections),
        db.highlights.bulkPut(doc.highlights),
        db.notes.bulkPut(doc.notes),
        db.savedSearches.bulkPut(doc.savedSearches),
        db.readingUnits.bulkPut(doc.readingUnits),
      ])
    }
  )
}

const MAX_ATTEMPTS = 3

/**
 * Reconcile local state with the copy in Drive.
 *
 * Read remote, merge with local, write back, apply the merged result locally.
 * If another device wrote during the round trip, Drive's version check fails
 * and we retry with fresh data — so a concurrent edit is never silently lost.
 *
 * @param interactive true when triggered by a click, which is the only context
 *   where re-authentication is allowed to open a window.
 */
export async function runSync(interactive: boolean): Promise<void> {
  if (!SYNC_AVAILABLE) return

  const { setSync, sync } = useAppStore.getState()
  const user = 'user' in sync ? sync.user : undefined

  try {
    const token = await getAccessToken(interactive)
    const identity = user ?? (await fetchUserInfo(token))
    setSync({ status: 'syncing', user: identity })

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const remote = await readRemote(token)
      const local = await exportLocal()
      const merged = pruneTombstones(
        mergeDocuments(local, remote?.document ?? EMPTY_SYNC_DOCUMENT)
      )

      try {
        await writeRemote(
          token,
          merged,
          remote ? { fileId: remote.fileId, expectedVersion: remote.version } : undefined
        )
      } catch (error) {
        // Another device wrote first: re-read and merge again.
        if (error instanceof ConcurrentWriteError && attempt < MAX_ATTEMPTS) continue
        throw error
      }

      await importLocal(merged)
      setSync({ status: 'idle', user: identity, lastSyncAt: Date.now() })
      return
    }

    throw new ConcurrentWriteError()
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      setSync({ status: 'signed-out' })
      return
    }
    setSync({
      status: 'error',
      user,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function startSync(): Promise<void> {
  await runSync(true)
}

export function stopSync(): void {
  signOut()
  useAppStore.getState().setSync({ status: 'signed-out' })
}

/**
 * Sync opportunistically: on regaining focus and after changes settle.
 * Never runs interactively, so it can't surprise the user with a popup.
 */
export function installSyncTriggers(): () => void {
  if (!SYNC_AVAILABLE) return () => undefined

  let debounce: number | undefined
  const schedule = () => {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      const { sync } = useAppStore.getState()
      if (sync.status === 'idle' || sync.status === 'error') void runSync(false)
    }, 4000)
  }

  const onFocus = () => {
    if (document.visibilityState === 'visible') schedule()
  }

  document.addEventListener('visibilitychange', onFocus)
  window.addEventListener('focus', onFocus)

  // Any local write is a reason to push; Dexie's hooks fire for every table.
  const tables = [
    db.progress,
    db.library,
    db.collections,
    db.highlights,
    db.notes,
    db.savedSearches,
    db.readingUnits,
  ]
  const unhook = tables.map((table) => {
    const handler = () => schedule()
    table.hook('creating', handler)
    table.hook('updating', handler)
    return () => {
      table.hook('creating').unsubscribe(handler)
      table.hook('updating').unsubscribe(handler)
    }
  })

  return () => {
    window.clearTimeout(debounce)
    document.removeEventListener('visibilitychange', onFocus)
    window.removeEventListener('focus', onFocus)
    unhook.forEach((fn) => fn())
  }
}

export { mergeDocuments, normalizeDocument, pruneTombstones, EMPTY_SYNC_DOCUMENT } from './merge'
