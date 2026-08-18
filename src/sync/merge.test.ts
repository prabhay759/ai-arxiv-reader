import { describe, expect, it } from 'vitest'
import type { LibraryEntry, ReadingUnitState, SyncDocument } from '@/types'
import {
  EMPTY_SYNC_DOCUMENT,
  mergeDocuments,
  mergeRecords,
  normalizeDocument,
  pruneTombstones,
} from './merge'

function unitState(
  unitKey: string,
  updatedAt: number,
  overrides: Partial<ReadingUnitState> = {}
): ReadingUnitState {
  return {
    id: `2608.13560#${unitKey}`,
    paperId: '2608.13560',
    unitKey,
    label: unitKey,
    ordinal: 0,
    done: true,
    updatedAt,
    ...overrides,
  }
}

function entry(paperId: string, updatedAt: number, overrides: Partial<LibraryEntry> = {}) {
  return {
    paperId,
    status: 'unread' as const,
    starred: false,
    collectionIds: [],
    tags: [],
    addedAt: 0,
    updatedAt,
    ...overrides,
  }
}

describe('mergeRecords', () => {
  it('keeps the newer of two versions of the same record', () => {
    const merged = mergeRecords(
      [entry('a', 200, { starred: true })],
      [entry('a', 100, { starred: false })],
      (r) => r.paperId
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].starred).toBe(true)
  })

  it('takes the remote version when it is newer', () => {
    const merged = mergeRecords(
      [entry('a', 100, { status: 'unread' })],
      [entry('a', 300, { status: 'finished' })],
      (r) => r.paperId
    )
    expect(merged[0].status).toBe('finished')
  })

  it('unions records that exist on only one side', () => {
    const merged = mergeRecords([entry('a', 1)], [entry('b', 1)], (r) => r.paperId)
    expect(merged.map((r) => r.paperId).sort()).toEqual(['a', 'b'])
  })

  it('prefers local on an exact timestamp tie', () => {
    const merged = mergeRecords(
      [entry('a', 500, { starred: true })],
      [entry('a', 500, { starred: false })],
      (r) => r.paperId
    )
    expect(merged[0].starred).toBe(true)
  })

  it('propagates a deletion instead of resurrecting the record', () => {
    // The failure this guards: delete on phone, sync on laptop, and the
    // laptop's older live copy silently brings it back.
    const merged = mergeRecords(
      [entry('a', 100)],
      [entry('a', 200, { deleted: true })],
      (r) => r.paperId
    )
    expect(merged[0].deleted).toBe(true)
  })

  it('lets a later edit win over an earlier deletion', () => {
    const merged = mergeRecords(
      [entry('a', 300, { starred: true })],
      [entry('a', 200, { deleted: true })],
      (r) => r.paperId
    )
    expect(merged[0].deleted).toBeUndefined()
    expect(merged[0].starred).toBe(true)
  })
})

describe('mergeDocuments', () => {
  const base = (overrides: Partial<SyncDocument>): SyncDocument => ({
    ...EMPTY_SYNC_DOCUMENT,
    ...overrides,
  })

  it('merges every collection independently', () => {
    const local = base({
      updatedAt: 10,
      library: [entry('a', 10)],
      progress: [
        { paperId: 'p', anchor: { mode: 'html', percent: 0.2 }, updatedAt: 50 },
      ],
    })
    const remote = base({
      updatedAt: 20,
      library: [entry('b', 20)],
      progress: [{ paperId: 'p', anchor: { mode: 'pdf', percent: 0.9 }, updatedAt: 80 }],
    })

    const merged = mergeDocuments(local, remote)
    expect(merged.library.map((r) => r.paperId).sort()).toEqual(['a', 'b'])
    expect(merged.progress[0].anchor.percent).toBe(0.9)
    expect(merged.updatedAt).toBe(20)
  })

  it('keeps the newer settings block', () => {
    const merged = mergeDocuments(
      base({ settings: { theme: 'dark', reader: {} as never, updatedAt: 5 } }),
      base({ settings: { theme: 'light', reader: {} as never, updatedAt: 9 } })
    )
    expect(merged.settings?.theme).toBe('light')
  })

  it('merging an empty remote preserves all local data', () => {
    // This is the first-sign-in case: a guest's local data must survive.
    const local = base({
      library: [entry('a', 1), entry('b', 2)],
      notes: [{ paperId: 'a', body: 'hello', updatedAt: 3 }],
    })
    const merged = mergeDocuments(local, EMPTY_SYNC_DOCUMENT)
    expect(merged.library).toHaveLength(2)
    expect(merged.notes[0].body).toBe('hello')
  })
})

describe('pruneTombstones', () => {
  const now = 1_000_000_000_000

  it('drops tombstones older than the retention window', () => {
    const old = now - 91 * 24 * 3600 * 1000
    const doc = { ...EMPTY_SYNC_DOCUMENT, library: [entry('a', old, { deleted: true })] }
    expect(pruneTombstones(doc, now).library).toHaveLength(0)
  })

  it('keeps recent tombstones so deletions still propagate', () => {
    const recent = now - 3 * 24 * 3600 * 1000
    const doc = { ...EMPTY_SYNC_DOCUMENT, library: [entry('a', recent, { deleted: true })] }
    expect(pruneTombstones(doc, now).library).toHaveLength(1)
  })

  it('never drops live records regardless of age', () => {
    const ancient = now - 400 * 24 * 3600 * 1000
    const doc = { ...EMPTY_SYNC_DOCUMENT, library: [entry('a', ancient)] }
    expect(pruneTombstones(doc, now).library).toHaveLength(1)
  })
})


describe('reading units sync', () => {
  it('merges unit state by id, newest wins', () => {
    const merged = mergeDocuments(
      { ...EMPTY_SYNC_DOCUMENT, readingUnits: [unitState('method', 200, { rating: 'lost' })] },
      { ...EMPTY_SYNC_DOCUMENT, readingUnits: [unitState('method', 100, { rating: 'got' })] }
    )
    expect(merged.readingUnits).toHaveLength(1)
    expect(merged.readingUnits[0].rating).toBe('lost')
  })

  it('unions units read on different devices', () => {
    const merged = mergeDocuments(
      { ...EMPTY_SYNC_DOCUMENT, readingUnits: [unitState('intro', 1)] },
      { ...EMPTY_SYNC_DOCUMENT, readingUnits: [unitState('method', 1, { id: '2608.13560#method' })] }
    )
    expect(merged.readingUnits.map((u) => u.unitKey).sort()).toEqual(['intro', 'method'])
  })

  it('prunes unit tombstones on the same schedule as everything else', () => {
    const old = 120 * 24 * 60 * 60 * 1000
    const doc = {
      ...EMPTY_SYNC_DOCUMENT,
      readingUnits: [unitState('gone', 0, { deleted: true }), unitState('kept', old)],
    }
    const pruned = pruneTombstones(doc, old)
    expect(pruned.readingUnits.map((u) => u.unitKey)).toEqual(['kept'])
  })
})

describe('documents written by an older build', () => {
  // The regression this guards: a document already sitting in someone's Drive
  // predates `readingUnits`, so it arrives without that key. Reading .length
  // off undefined turns a feature addition into "sync is broken" for exactly
  // the people who have used the app longest.
  const legacy = {
    schema: 1 as const,
    updatedAt: 5,
    progress: [],
    library: [entry('a', 5)],
    collections: [],
    highlights: [],
    notes: [],
    savedSearches: [],
  }

  it('merges against a document with no readingUnits at all', () => {
    const merged = mergeDocuments(
      { ...EMPTY_SYNC_DOCUMENT, readingUnits: [unitState('intro', 9)] },
      legacy as unknown as SyncDocument
    )
    expect(merged.readingUnits).toHaveLength(1)
    expect(merged.library).toHaveLength(1)
  })

  it('survives a local document missing the field too', () => {
    const merged = mergeDocuments(legacy as unknown as SyncDocument, legacy as unknown as SyncDocument)
    expect(merged.readingUnits).toEqual([])
  })

  it('normalizes a null or truncated document rather than throwing', () => {
    expect(normalizeDocument(null).readingUnits).toEqual([])
    expect(normalizeDocument({ schema: 1, updatedAt: 1 }).library).toEqual([])
  })
})
