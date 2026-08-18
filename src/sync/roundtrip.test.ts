/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PaperSummary, ReadingAnchor, SyncDocument } from '@/types'
import type { ReadingUnit } from '@/reader/units'
import { db } from '@/store/db'
import { getProgress, saveProgress } from '@/store/library'
import { listUnitStates, markUnitsDone, rateUnit } from '@/store/readingUnits'
import { exportLocal, importLocal } from './index'
import { mergeDocuments } from './merge'

/**
 * The whole sync path except the network.
 *
 * Drive sync is exportLocal -> merge -> importLocal with an HTTP round trip in
 * the middle; the same three functions back the Settings export/import files.
 * Everything that can actually lose a reader's place lives in those three, so
 * they are what these tests drive — a mocked Drive would only prove the mock
 * works.
 */

const PAPER: PaperSummary = {
  id: '2608.13560',
  title: 'AutoDesign',
  authors: ['A. Author'],
  categories: ['cs.AI'],
  published: '2026-08-13',
}

const ANCHOR: ReadingAnchor = {
  mode: 'html',
  elementId: 'S3.p2',
  charOffset: 120,
  percent: 0.42,
}

const unit = (key: string, ordinal: number): ReadingUnit => ({
  key,
  elementId: `S${ordinal + 1}`,
  endElementId: `S${ordinal + 1}`,
  label: key,
  level: 1,
  words: 400,
  minutes: 2,
  appendix: false,
  ordinal,
})

async function wipeDevice(): Promise<void> {
  await Promise.all([
    db.progress.clear(),
    db.library.clear(),
    db.collections.clear(),
    db.highlights.clear(),
    db.notes.clear(),
    db.savedSearches.clear(),
    db.readingUnits.clear(),
    db.papers.clear(),
  ])
}

beforeEach(wipeDevice)

describe('picking up where you left off on another device', () => {
  it('carries the reading position through a full round trip', async () => {
    await saveProgress(PAPER, ANCHOR, 9)
    const uploaded = await exportLocal()

    await wipeDevice()
    expect(await getProgress(PAPER.id)).toBeUndefined()

    await importLocal(mergeDocuments(await exportLocal(), uploaded))

    const restored = await getProgress(PAPER.id)
    expect(restored?.anchor.elementId).toBe('S3.p2')
    expect(restored?.anchor.charOffset).toBe(120)
    expect(restored?.anchor.percent).toBeCloseTo(0.42)
    expect(restored?.anchor.mode).toBe('html')
  })

  it('carries the reading path and its ratings', async () => {
    await markUnitsDone(PAPER.id, [unit('introduction', 0), unit('method', 1)])
    await rateUnit(PAPER, unit('method', 1), 'fuzzy')
    const uploaded = await exportLocal()

    await wipeDevice()
    await importLocal(mergeDocuments(await exportLocal(), uploaded))

    const states = await listUnitStates(PAPER.id)
    expect(states.get('introduction')?.done).toBe(true)
    expect(states.get('method')?.rating).toBe('fuzzy')
  })

  it('unions units read on two devices instead of picking a winner', async () => {
    // The real two-device case: the laptop read the intro, the phone read the
    // method, and neither device has ever seen the other's rows.
    await markUnitsDone(PAPER.id, [unit('introduction', 0)])
    const laptop = await exportLocal()

    await wipeDevice()
    await markUnitsDone(PAPER.id, [unit('method', 1)])
    const phone = await exportLocal()

    await importLocal(mergeDocuments(phone, laptop))

    const states = await listUnitStates(PAPER.id)
    expect([...states.keys()].sort()).toEqual(['introduction', 'method'])
  })

  it('lets the newer rating win when both devices rated the same unit', async () => {
    await rateUnit(PAPER, unit('method', 1), 'got')
    const stale = await exportLocal()

    await new Promise((resolve) => setTimeout(resolve, 5))
    await rateUnit(PAPER, unit('method', 1), 'lost')
    const fresh = await exportLocal()

    await wipeDevice()
    await importLocal(mergeDocuments(stale, fresh))
    expect((await listUnitStates(PAPER.id)).get('method')?.rating).toBe('lost')
  })

  it('does not lose the position when the other device knows nothing about paths', async () => {
    // A device still on the previous release uploads a document with no
    // readingUnits key at all. Merging must not throw, and must not discard
    // this device's path.
    await saveProgress(PAPER, ANCHOR, 9)
    await markUnitsDone(PAPER.id, [unit('introduction', 0)])

    const legacy = { ...(await exportLocal()) } as Partial<SyncDocument>
    delete legacy.readingUnits
    legacy.updatedAt = 1

    await importLocal(mergeDocuments(await exportLocal(), legacy as SyncDocument))

    expect((await listUnitStates(PAPER.id)).get('introduction')?.done).toBe(true)
    expect((await getProgress(PAPER.id))?.anchor.elementId).toBe('S3.p2')
  })

  it('exports units in the document it would upload', async () => {
    await markUnitsDone(PAPER.id, [unit('introduction', 0)])
    const doc = await exportLocal()
    expect(doc.readingUnits).toHaveLength(1)
    expect(doc.readingUnits[0].unitKey).toBe('introduction')
  })
})
