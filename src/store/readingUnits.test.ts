/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReadingUnit } from '@/reader/units'
import type { PaperSummary } from '@/types'
import { db } from './db'
import {
  clearRevisit,
  listRevisits,
  listUnitStates,
  markUnitsDone,
  rateUnit,
  unitStateId,
} from './readingUnits'

const PAPER: PaperSummary = {
  id: '2608.13560',
  title: 'AutoDesign',
  authors: ['A. Author'],
  categories: ['cs.AI'],
  published: '2026-08-13',
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

const INTRO = unit('introduction', 0)
const METHOD = unit('method', 1)

beforeEach(async () => {
  await db.readingUnits.clear()
  await db.papers.clear()
})

describe('marking units read', () => {
  it('records units and reads them back by key', async () => {
    await markUnitsDone(PAPER.id, [INTRO, METHOD])
    const states = await listUnitStates(PAPER.id)

    expect([...states.keys()].sort()).toEqual(['introduction', 'method'])
    expect(states.get('introduction')?.done).toBe(true)
    expect(states.get('introduction')?.id).toBe(unitStateId(PAPER.id, 'introduction'))
  })

  it('writes nothing when everything is already done', async () => {
    // This runs on every scroll tick. If it rewrote rows each time, a slow
    // scroll through a finished paper would push a sync on every frame.
    await markUnitsDone(PAPER.id, [INTRO])
    const written = await markUnitsDone(PAPER.id, [INTRO])
    expect(written).toEqual([])
  })

  it('reports only the units newly finished', async () => {
    await markUnitsDone(PAPER.id, [INTRO])
    expect(await markUnitsDone(PAPER.id, [INTRO, METHOD])).toEqual(['method'])
  })

  it('keeps the original completion time when re-marked', async () => {
    await markUnitsDone(PAPER.id, [INTRO])
    const first = (await listUnitStates(PAPER.id)).get('introduction')?.completedAt

    await rateUnit(PAPER, INTRO, 'fuzzy')
    expect((await listUnitStates(PAPER.id)).get('introduction')?.completedAt).toBe(first)
  })

  it('does not resurrect a tombstoned unit as undeleted state', async () => {
    await markUnitsDone(PAPER.id, [INTRO])
    const id = unitStateId(PAPER.id, 'introduction')
    await db.readingUnits.put({
      ...(await db.readingUnits.get(id))!,
      deleted: true,
      updatedAt: Date.now(),
    })
    expect((await listUnitStates(PAPER.id)).has('introduction')).toBe(false)
  })
})

describe('rating a unit', () => {
  it('implies the unit was read', async () => {
    // You cannot judge a section you skipped, so rating marks it done too.
    await rateUnit(PAPER, METHOD, 'lost')
    const state = (await listUnitStates(PAPER.id)).get('method')
    expect(state?.done).toBe(true)
    expect(state?.rating).toBe('lost')
  })

  it('caches the paper so the revisit queue can name it', async () => {
    await rateUnit(PAPER, METHOD, 'fuzzy')
    expect((await db.papers.get(PAPER.id))?.title).toBe('AutoDesign')
  })

  it('clears on a second press, for a mis-tap', async () => {
    await rateUnit(PAPER, METHOD, 'fuzzy')
    await rateUnit(PAPER, METHOD, undefined)

    const state = (await listUnitStates(PAPER.id)).get('method')
    expect(state?.rating).toBeUndefined()
    // Still read — undoing the rating must not undo the reading.
    expect(state?.done).toBe(true)
  })
})

describe('the revisit queue', () => {
  it('holds only what did not land', async () => {
    await rateUnit(PAPER, INTRO, 'got')
    await rateUnit(PAPER, METHOD, 'fuzzy')
    await rateUnit(PAPER, unit('results', 2), 'lost')

    const queue = await listRevisits()
    expect(queue.map((row) => row.unitKey).sort()).toEqual(['method', 'results'])
  })

  it('puts the most recently flagged first', async () => {
    await rateUnit(PAPER, INTRO, 'fuzzy')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await rateUnit(PAPER, METHOD, 'lost')

    expect((await listRevisits()).map((row) => row.unitKey)).toEqual(['method', 'introduction'])
  })

  it('clearing a flag leaves the unit read', async () => {
    await rateUnit(PAPER, METHOD, 'fuzzy')
    await clearRevisit(unitStateId(PAPER.id, 'method'))

    expect(await listRevisits()).toEqual([])
    expect((await listUnitStates(PAPER.id)).get('method')?.done).toBe(true)
  })
})
