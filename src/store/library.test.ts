/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PaperSummary, ReadingAnchor } from '@/types'
import { db } from './db'
import {
  clearProgress,
  continueReading,
  getLibraryEntry,
  getProgress,
  saveProgress,
  toggleBookmark,
} from './library'
import { createHighlight, listHighlights } from './highlights'

const paper = (id: string, title = `Paper ${id}`): PaperSummary => ({
  id,
  title,
  authors: ['A. Author'],
  categories: ['cs.AI'],
  published: '2026-08-13',
})

const anchor = (percent: number): ReadingAnchor => ({ mode: 'html', percent })

beforeEach(async () => {
  await Promise.all([db.progress.clear(), db.papers.clear(), db.library.clear(), db.highlights.clear()])
})

describe('the continue-reading list', () => {
  it('lists papers that are started but unfinished, newest first', async () => {
    await saveProgress(paper('2608.1'), anchor(0.2), 10)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await saveProgress(paper('2608.2'), anchor(0.5), 10)

    expect((await continueReading()).map((row) => row.paper.id)).toEqual(['2608.2', '2608.1'])
  })

  it('drops a paper once it is essentially finished', async () => {
    await saveProgress(paper('2608.1'), anchor(0.99), 10)
    expect(await continueReading()).toEqual([])
  })

  it('removes a paper when its progress is cleared', async () => {
    await saveProgress(paper('2608.1'), anchor(0.2), 10)
    await saveProgress(paper('2608.2'), anchor(0.3), 10)

    await clearProgress('2608.1')

    expect((await continueReading()).map((row) => row.paper.id)).toEqual(['2608.2'])
  })

  it('tombstones rather than deletes, so the removal reaches other devices', async () => {
    await saveProgress(paper('2608.1'), anchor(0.2), 10)
    await clearProgress('2608.1')

    const row = await db.progress.get('2608.1')
    expect(row).toBeDefined()
    expect(row?.deleted).toBe(true)
    // And the app-level reader agrees it is gone.
    expect(await getProgress('2608.1')).toBeUndefined()
  })

  it('keeps everything except the reading position', async () => {
    // Removing from the shelf means "stop suggesting this", not "forget I
    // ever read it" — the library entry, highlights and notes all stay.
    const subject = paper('2608.1')
    await toggleBookmark(subject)
    await saveProgress(subject, anchor(0.4), 10)
    await createHighlight(
      subject.id,
      { mode: 'html', exact: 'attention', prefix: '', suffix: '' },
      'yellow'
    )

    await clearProgress('2608.1')

    expect(await getLibraryEntry('2608.1')).toBeDefined()
    expect(await listHighlights('2608.1')).toHaveLength(1)
    expect(await db.papers.get('2608.1')).toBeDefined()
  })

  it('is silent about clearing a paper that was never started', async () => {
    await expect(clearProgress('2608.never')).resolves.toBeUndefined()
  })

  it('starts fresh if the paper is reopened after removal', async () => {
    await saveProgress(paper('2608.1'), anchor(0.4), 10)
    await clearProgress('2608.1')
    expect(await getProgress('2608.1')).toBeUndefined()

    await saveProgress(paper('2608.1'), anchor(0.1), 10)
    expect((await getProgress('2608.1'))?.anchor.percent).toBeCloseTo(0.1)
    expect((await continueReading()).map((row) => row.paper.id)).toEqual(['2608.1'])
  })
})
