import { describe, expect, it } from 'vitest'
import type { LibraryEntry, SyncDocument } from '@/types'
import { EMPTY_SYNC_DOCUMENT, mergeDocuments, mergeRecords, pruneTombstones } from './merge'

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
