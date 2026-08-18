import Dexie, { type Table } from 'dexie'
import type {
  AppSettings,
  Collection,
  Highlight,
  LibraryEntry,
  Note,
  PaperSummary,
  ReadingProgress,
  ReadingUnitState,
  SavedSearch,
  SearchHistoryEntry,
} from '@/types'
import { DEFAULT_READER_SETTINGS } from '@/types'

/**
 * Local database. This is the single source of truth for the whole app:
 * everything reads and writes here, and Google Drive sync is a layer on top
 * that reconciles this database with the copy in the user's Drive. Nothing in
 * the UI ever blocks on the network, which is why guest mode is not a
 * degraded experience — it is the normal one, minus cross-device sync.
 *
 * Every syncable record carries `updatedAt`, and deletions are tombstones
 * (`deleted: true`) rather than row removals. Without tombstones, a delete on
 * one device would be silently resurrected by the next sync from another.
 */
export class ReaderDatabase extends Dexie {
  papers!: Table<PaperSummary & { cachedAt: number }, string>
  progress!: Table<ReadingProgress, string>
  library!: Table<LibraryEntry, string>
  collections!: Table<Collection, string>
  highlights!: Table<Highlight, string>
  notes!: Table<Note, string>
  savedSearches!: Table<SavedSearch, string>
  readingUnits!: Table<ReadingUnitState, string>
  searchHistory!: Table<SearchHistoryEntry, string>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor(name = 'arxiv-reader') {
    super(name)
    this.version(1).stores({
      papers: 'id, cachedAt',
      progress: 'paperId, updatedAt',
      library: 'paperId, status, starred, addedAt, updatedAt, *collectionIds, *tags',
      collections: 'id, order, updatedAt',
      highlights: 'id, paperId, updatedAt, createdAt',
      notes: 'paperId, updatedAt',
      savedSearches: 'id, createdAt, updatedAt',
      searchHistory: 'id, at',
      meta: 'key',
    })

    // v2 adds the guided-reading path. Dexie creates the new store and leaves
    // every existing one untouched, so nothing already on the device moves.
    this.version(2).stores({
      readingUnits: 'id, paperId, updatedAt, rating, done',
    })
  }
}

export const db = new ReaderDatabase()

export const now = (): number => Date.now()

/** Collision-resistant enough for per-user records, no dependency needed. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const SETTINGS_KEY = 'settings'

export async function readSettings(): Promise<AppSettings> {
  const row = await db.meta.get(SETTINGS_KEY)
  const stored = row?.value as Partial<AppSettings> | undefined
  return {
    theme: stored?.theme ?? 'system',
    reader: { ...DEFAULT_READER_SETTINGS, ...stored?.reader },
    updatedAt: stored?.updatedAt ?? 0,
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await db.meta.put({ key: SETTINGS_KEY, value: { ...settings, updatedAt: now() } })
}

/** Cache display metadata so the library and history work offline. */
export async function cachePaper(paper: PaperSummary): Promise<void> {
  await db.papers.put({ ...paper, cachedAt: now() })
}

export async function cachedPaper(id: string): Promise<PaperSummary | undefined> {
  return db.papers.get(id)
}

/**
 * Live-count of everything that would be uploaded on first sign-in, used to
 * decide whether to offer the "merge your local data" prompt at all.
 */
export async function localDataCount(): Promise<number> {
  const counts = await Promise.all([
    db.progress.count(),
    db.library.count(),
    db.highlights.count(),
    db.notes.count(),
    db.collections.count(),
    db.savedSearches.count(),
    db.readingUnits.count(),
  ])
  return counts.reduce((total, count) => total + count, 0)
}

/** Wipes user data. Used by "sign out and forget this device". */
export async function clearLocalData(): Promise<void> {
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
      db.searchHistory,
    ],
    async () => {
      await Promise.all([
        db.progress.clear(),
        db.library.clear(),
        db.collections.clear(),
        db.highlights.clear(),
        db.notes.clear(),
        db.savedSearches.clear(),
        db.readingUnits.clear(),
        db.searchHistory.clear(),
      ])
    }
  )
}
