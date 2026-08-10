import type { SyncDocument } from '@/types'

/** Every syncable record carries these; deletes are tombstones, not removals. */
interface Syncable {
  updatedAt: number
  deleted?: boolean
}

/**
 * Merge two sets of records by identity, last write wins.
 *
 * Ties go to the *local* copy. That is deliberate: a tie means both sides have
 * the same timestamp, so the values are almost certainly identical, and
 * preferring local avoids a pointless write-back on every sync.
 */
export function mergeRecords<T extends Syncable>(
  local: T[],
  remote: T[],
  keyOf: (record: T) => string
): T[] {
  const merged = new Map<string, T>()

  for (const record of remote) merged.set(keyOf(record), record)

  for (const record of local) {
    const key = keyOf(record)
    const existing = merged.get(key)
    if (!existing || record.updatedAt >= existing.updatedAt) merged.set(key, record)
  }

  return [...merged.values()]
}

/**
 * Merge two whole sync documents.
 *
 * Tombstones are preserved rather than dropped — a record deleted on a phone
 * must stay deleted after the laptop syncs, and the only way to express that
 * is to keep carrying the tombstone.
 */
export function mergeDocuments(local: SyncDocument, remote: SyncDocument): SyncDocument {
  return {
    schema: 1,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    progress: mergeRecords(local.progress, remote.progress, (r) => r.paperId),
    library: mergeRecords(local.library, remote.library, (r) => r.paperId),
    collections: mergeRecords(local.collections, remote.collections, (r) => r.id),
    highlights: mergeRecords(local.highlights, remote.highlights, (r) => r.id),
    notes: mergeRecords(local.notes, remote.notes, (r) => r.paperId),
    savedSearches: mergeRecords(local.savedSearches, remote.savedSearches, (r) => r.id),
    settings:
      (local.settings?.updatedAt ?? 0) >= (remote.settings?.updatedAt ?? 0)
        ? local.settings
        : remote.settings,
  }
}

export const EMPTY_SYNC_DOCUMENT: SyncDocument = {
  schema: 1,
  updatedAt: 0,
  progress: [],
  library: [],
  collections: [],
  highlights: [],
  notes: [],
  savedSearches: [],
}

/**
 * Drop tombstones that everyone has certainly seen, so the synced document
 * doesn't grow forever. 90 days is far longer than any plausible gap between
 * a user's devices syncing.
 */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function pruneTombstones(doc: SyncDocument, now = Date.now()): SyncDocument {
  const fresh = <T extends Syncable>(records: T[]): T[] =>
    records.filter((record) => !record.deleted || now - record.updatedAt < TOMBSTONE_TTL_MS)

  return {
    ...doc,
    progress: fresh(doc.progress),
    library: fresh(doc.library),
    collections: fresh(doc.collections),
    highlights: fresh(doc.highlights),
    notes: fresh(doc.notes),
    savedSearches: fresh(doc.savedSearches),
  }
}

/** Count of records a document would contribute, for the merge prompt. */
export function countRecords(doc: SyncDocument): number {
  return (
    doc.progress.length +
    doc.library.length +
    doc.collections.length +
    doc.highlights.length +
    doc.notes.length +
    doc.savedSearches.length
  )
}
