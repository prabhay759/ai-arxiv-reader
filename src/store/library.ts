import type {
  Collection,
  HighlightColor,
  LibraryEntry,
  PaperSummary,
  ReadStatus,
  ReadingAnchor,
  ReadingProgress,
  SearchFilters,
} from '@/types'
import { cachePaper, db, newId, now } from './db'

/**
 * Library operations. Every mutation stamps `updatedAt` and every delete
 * writes a tombstone, so Drive sync can reconcile without losing changes.
 */

export async function getLibraryEntry(paperId: string): Promise<LibraryEntry | undefined> {
  const entry = await db.library.get(paperId)
  return entry?.deleted ? undefined : entry
}

async function upsertEntry(
  paperId: string,
  mutate: (entry: LibraryEntry) => LibraryEntry
): Promise<LibraryEntry> {
  const existing = await db.library.get(paperId)
  const base: LibraryEntry = existing?.deleted || !existing
    ? {
        paperId,
        status: 'unread',
        starred: false,
        collectionIds: [],
        tags: [],
        addedAt: now(),
        updatedAt: now(),
      }
    : existing

  const next = { ...mutate(base), updatedAt: now(), deleted: undefined }
  await db.library.put(next)
  return next
}

export async function toggleBookmark(paper: PaperSummary): Promise<boolean> {
  await cachePaper(paper)
  const existing = await getLibraryEntry(paper.id)
  if (existing) {
    // Tombstone rather than delete, so sync propagates the removal.
    await db.library.put({ ...existing, deleted: true, updatedAt: now() })
    return false
  }
  await upsertEntry(paper.id, (entry) => entry)
  return true
}

export async function setReadStatus(paperId: string, status: ReadStatus): Promise<void> {
  await upsertEntry(paperId, (entry) => ({ ...entry, status }))
}

export async function setStarred(paperId: string, starred: boolean): Promise<void> {
  await upsertEntry(paperId, (entry) => ({ ...entry, starred }))
}

export async function setTags(paperId: string, tags: string[]): Promise<void> {
  const normalized = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort()
  await upsertEntry(paperId, (entry) => ({ ...entry, tags: normalized }))
}

export async function setCollections(paperId: string, collectionIds: string[]): Promise<void> {
  await upsertEntry(paperId, (entry) => ({ ...entry, collectionIds: [...new Set(collectionIds)] }))
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const entries = await db.library.toArray()
  return entries.filter((e) => !e.deleted).sort((a, b) => b.addedAt - a.addedAt)
}

export async function allTags(): Promise<Array<{ tag: string; count: number }>> {
  const counts = new Map<string, number>()
  for (const entry of await listLibrary()) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ---------------------------------------------------------------- collections

export async function listCollections(): Promise<Collection[]> {
  const collections = await db.collections.toArray()
  return collections.filter((c) => !c.deleted).sort((a, b) => a.order - b.order)
}

export async function createCollection(name: string, color: HighlightColor): Promise<Collection> {
  const existing = await listCollections()
  const collection: Collection = {
    id: newId(),
    name: name.trim() || 'Untitled collection',
    color,
    order: existing.length,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.collections.put(collection)
  return collection
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const collection = await db.collections.get(id)
  if (!collection) return
  await db.collections.put({ ...collection, name: name.trim() || collection.name, updatedAt: now() })
}

export async function deleteCollection(id: string): Promise<void> {
  const collection = await db.collections.get(id)
  if (collection) await db.collections.put({ ...collection, deleted: true, updatedAt: now() })

  // Detach the collection from its papers so they don't keep a dangling id.
  const members = await db.library.where('collectionIds').equals(id).toArray()
  await Promise.all(
    members.map((entry) =>
      db.library.put({
        ...entry,
        collectionIds: entry.collectionIds.filter((c) => c !== id),
        updatedAt: now(),
      })
    )
  )
}

// ------------------------------------------------------------------ progress

export async function saveProgress(
  paper: PaperSummary,
  anchor: ReadingAnchor,
  total?: number
): Promise<void> {
  await cachePaper(paper)
  await db.progress.put({ paperId: paper.id, anchor, total, updatedAt: now() })

  // Opening a paper and actually moving through it implies you're reading it;
  // promote status automatically so the library reflects reality without the
  // user having to curate it by hand.
  if (anchor.percent > 0.02) {
    const entry = await getLibraryEntry(paper.id)
    if (entry && entry.status === 'unread') {
      await upsertEntry(paper.id, (e) => ({ ...e, status: 'reading' }))
    }
    if (anchor.percent > 0.95 && entry && entry.status !== 'finished') {
      await upsertEntry(paper.id, (e) => ({ ...e, status: 'finished' }))
    }
  }
}

export async function getProgress(paperId: string): Promise<ReadingProgress | undefined> {
  const progress = await db.progress.get(paperId)
  return progress?.deleted ? undefined : progress
}

/** Papers with saved progress that aren't finished — the "Continue" shelf. */
export async function continueReading(limit = 12): Promise<
  Array<{ progress: ReadingProgress; paper: PaperSummary }>
> {
  const rows = await db.progress.orderBy('updatedAt').reverse().limit(limit * 3).toArray()
  const out: Array<{ progress: ReadingProgress; paper: PaperSummary }> = []

  for (const progress of rows) {
    if (progress.deleted) continue
    if (progress.anchor.percent >= 0.97) continue
    const paper = await db.papers.get(progress.paperId)
    if (paper) out.push({ progress, paper })
    if (out.length >= limit) break
  }
  return out
}

export async function clearProgress(paperId: string): Promise<void> {
  const progress = await db.progress.get(paperId)
  if (progress) await db.progress.put({ ...progress, deleted: true, updatedAt: now() })
}

// ------------------------------------------------------------ saved searches

export async function saveSearch(
  name: string,
  query: string,
  filters: SearchFilters
): Promise<void> {
  await db.savedSearches.put({
    id: newId(),
    name: name.trim() || query || 'Saved search',
    query,
    filters,
    createdAt: now(),
    updatedAt: now(),
  })
}

export async function listSavedSearches() {
  const rows = await db.savedSearches.toArray()
  return rows.filter((r) => !r.deleted).sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const row = await db.savedSearches.get(id)
  if (row) await db.savedSearches.put({ ...row, deleted: true, updatedAt: now() })
}

// ----------------------------------------------------------- search history

const HISTORY_LIMIT = 60

export async function recordSearch(query: string, resultCount: number): Promise<void> {
  const trimmed = query.trim()
  if (!trimmed) return

  // Collapse repeats: re-running a query should move it up, not duplicate it.
  const existing = await db.searchHistory.filter((e) => e.query === trimmed).toArray()
  await Promise.all(existing.map((e) => db.searchHistory.delete(e.id)))
  await db.searchHistory.put({ id: newId(), query: trimmed, at: now(), resultCount })

  const all = await db.searchHistory.orderBy('at').reverse().toArray()
  await Promise.all(all.slice(HISTORY_LIMIT).map((e) => db.searchHistory.delete(e.id)))
}

export async function listSearchHistory(limit = 10) {
  return db.searchHistory.orderBy('at').reverse().limit(limit).toArray()
}

export async function clearSearchHistory(): Promise<void> {
  await db.searchHistory.clear()
}
