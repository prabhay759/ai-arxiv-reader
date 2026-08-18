import type { ReadingUnit } from '@/reader/units'
import type { ReadingUnitState, UnitRating } from '@/types'
import { cachePaper, db, now } from './db'
import type { PaperSummary } from '@/types'

/**
 * Per-unit state for the guided reading path.
 *
 * Like everything else in this app, writes stamp `updatedAt` and deletes are
 * tombstones, so Drive sync reconciles two devices without losing a rating.
 */

export const unitStateId = (paperId: string, unitKey: string): string =>
  `${paperId}#${unitKey}`

export async function listUnitStates(
  paperId: string
): Promise<Map<string, ReadingUnitState>> {
  const rows = await db.readingUnits.where('paperId').equals(paperId).toArray()
  return new Map(rows.filter((row) => !row.deleted).map((row) => [row.unitKey, row]))
}

/**
 * Record units the reader has scrolled past.
 *
 * Called on every scroll tick, so it must be cheap and idempotent: only units
 * that are not already marked done get written. Without that check a slow
 * scroll through a finished paper would rewrite every row on every frame and
 * trigger a sync push each time.
 *
 * Returns the keys actually written, so the caller can tell "nothing changed"
 * from "the path moved".
 */
export async function markUnitsDone(
  paperId: string,
  units: ReadingUnit[]
): Promise<string[]> {
  if (units.length === 0) return []

  const existing = await listUnitStates(paperId)
  const fresh = units.filter((unit) => !existing.get(unit.key)?.done)
  if (fresh.length === 0) return []

  const timestamp = now()
  await db.readingUnits.bulkPut(
    fresh.map((unit) => ({
      ...blank(paperId, unit),
      ...existing.get(unit.key),
      done: true,
      completedAt: existing.get(unit.key)?.completedAt ?? timestamp,
      updatedAt: timestamp,
      deleted: undefined,
    }))
  )
  return fresh.map((unit) => unit.key)
}

/**
 * Set or clear how a unit landed.
 *
 * Rating implies having read it — you cannot judge a section you skipped — so
 * this marks the unit done as well. Passing `undefined` clears the rating,
 * which is how a mis-tap is undone.
 */
export async function rateUnit(
  paper: PaperSummary,
  unit: ReadingUnit,
  rating: UnitRating | undefined
): Promise<void> {
  await cachePaper(paper)
  const existing = await db.readingUnits.get(unitStateId(paper.id, unit.key))
  const timestamp = now()

  await db.readingUnits.put({
    ...blank(paper.id, unit),
    ...(existing?.deleted ? {} : existing),
    label: unit.label,
    ordinal: unit.ordinal,
    done: true,
    rating,
    completedAt: existing?.completedAt ?? timestamp,
    updatedAt: timestamp,
    deleted: undefined,
  })
}

/** Units flagged as not fully landed, newest first — the revisit queue. */
export async function listRevisits(limit = 50): Promise<ReadingUnitState[]> {
  const rows = await db.readingUnits
    .filter((row) => !row.deleted && (row.rating === 'fuzzy' || row.rating === 'lost'))
    .toArray()

  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

/** Drop a unit from the revisit queue without forgetting it was read. */
export async function clearRevisit(id: string): Promise<void> {
  const existing = await db.readingUnits.get(id)
  if (!existing) return
  await db.readingUnits.put({ ...existing, rating: undefined, updatedAt: now() })
}

function blank(paperId: string, unit: ReadingUnit): ReadingUnitState {
  return {
    id: unitStateId(paperId, unit.key),
    paperId,
    unitKey: unit.key,
    label: unit.label,
    ordinal: unit.ordinal,
    done: false,
    updatedAt: now(),
  }
}
