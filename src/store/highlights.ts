import type { Highlight, HighlightAnchor, HighlightColor, Note, ReaderMode } from '@/types'
import { db, newId, now } from './db'

export async function listHighlights(paperId: string): Promise<Highlight[]> {
  const rows = await db.highlights.where('paperId').equals(paperId).toArray()
  return rows.filter((h) => !h.deleted).sort((a, b) => a.createdAt - b.createdAt)
}

export async function listAllHighlights(): Promise<Highlight[]> {
  const rows = await db.highlights.toArray()
  return rows.filter((h) => !h.deleted).sort((a, b) => b.createdAt - a.createdAt)
}

export async function createHighlight(
  paperId: string,
  anchor: HighlightAnchor,
  color: HighlightColor
): Promise<Highlight> {
  const highlight: Highlight = {
    id: newId(),
    paperId,
    color,
    anchor,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.highlights.put(highlight)
  return highlight
}

export async function updateHighlight(
  id: string,
  changes: Partial<Pick<Highlight, 'color' | 'note'>>
): Promise<void> {
  const highlight = await db.highlights.get(id)
  if (!highlight) return
  await db.highlights.put({ ...highlight, ...changes, updatedAt: now() })
}

export async function deleteHighlight(id: string): Promise<void> {
  const highlight = await db.highlights.get(id)
  if (highlight) await db.highlights.put({ ...highlight, deleted: true, updatedAt: now() })
}

// ---------------------------------------------------------------------- notes

export async function getNote(paperId: string): Promise<Note | undefined> {
  const note = await db.notes.get(paperId)
  return note?.deleted ? undefined : note
}

export async function saveNote(paperId: string, body: string): Promise<void> {
  if (!body.trim()) {
    const existing = await db.notes.get(paperId)
    if (existing) await db.notes.put({ ...existing, body: '', deleted: true, updatedAt: now() })
    return
  }
  await db.notes.put({ paperId, body, updatedAt: now() })
}

export async function searchNotes(
  query: string
): Promise<Array<{ paperId: string; body: string; title?: string }>> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const results: Array<{ paperId: string; body: string; title?: string }> = []
  const notes = (await db.notes.toArray()).filter((n) => !n.deleted)
  for (const note of notes) {
    if (!note.body.toLowerCase().includes(needle)) continue
    const paper = await db.papers.get(note.paperId)
    results.push({ paperId: note.paperId, body: note.body, title: paper?.title })
  }

  // Highlight notes are searchable too — they're where most annotation lives.
  for (const highlight of await listAllHighlights()) {
    const haystack = `${highlight.note ?? ''} ${highlight.anchor.exact}`.toLowerCase()
    if (!haystack.includes(needle)) continue
    const paper = await db.papers.get(highlight.paperId)
    results.push({
      paperId: highlight.paperId,
      body: highlight.note ? `${highlight.note} — "${highlight.anchor.exact}"` : `"${highlight.anchor.exact}"`,
      title: paper?.title,
    })
  }
  return results
}

// ------------------------------------------------------------------ anchoring

const CONTEXT_LENGTH = 32

/**
 * Build a quote-based anchor from a live DOM selection.
 *
 * We store the selected text plus its surrounding context rather than a
 * character offset, because arXiv re-renders papers (new LaTeXML versions,
 * author revisions) and any offset would silently drift onto the wrong words.
 * Text plus context re-locates correctly as long as the sentence survives.
 */
export function anchorFromSelection(
  range: Range,
  container: HTMLElement,
  mode: ReaderMode,
  locator: { elementId?: string; page?: number }
): HighlightAnchor | null {
  const exact = range.toString().trim()
  if (!exact) return null

  const full = container.textContent ?? ''
  const start = findRangeOffset(container, range)

  return {
    mode,
    ...locator,
    exact,
    prefix: start >= 0 ? full.slice(Math.max(0, start - CONTEXT_LENGTH), start) : '',
    suffix:
      start >= 0 ? full.slice(start + exact.length, start + exact.length + CONTEXT_LENGTH) : '',
  }
}

/** Character offset of a range's start within a container's text content. */
function findRangeOffset(container: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node = walker.nextNode()
  while (node) {
    if (node === range.startContainer) return offset + range.startOffset
    offset += node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  return -1
}

/**
 * Re-locate a stored anchor in the current document.
 *
 * Tries progressively looser strategies: exact text with both context sides,
 * then with either side, then the bare text. Returns null rather than guessing
 * when the text is genuinely gone, so a stale highlight disappears instead of
 * landing on unrelated words.
 */
export function locateAnchor(container: HTMLElement, anchor: HighlightAnchor): Range | null {
  const text = container.textContent ?? ''
  if (!anchor.exact) return null

  const candidates = [
    anchor.prefix + anchor.exact + anchor.suffix,
    anchor.prefix + anchor.exact,
    anchor.exact + anchor.suffix,
    anchor.exact,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const found = text.indexOf(candidate)
    if (found === -1) continue

    // Offset of `exact` inside whichever candidate matched.
    const exactStart = found + candidate.indexOf(anchor.exact)
    const range = rangeFromOffsets(container, exactStart, exactStart + anchor.exact.length)
    if (range) return range
  }
  return null
}

/** Map character offsets in a container's text back to a DOM Range. */
export function rangeFromOffsets(
  container: HTMLElement,
  start: number,
  end: number
): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let startSet = false
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0
    if (!startSet && offset + length >= start) {
      range.setStart(node, Math.max(0, start - offset))
      startSet = true
    }
    if (startSet && offset + length >= end) {
      range.setEnd(node, Math.max(0, end - offset))
      return range
    }
    offset += length
    node = walker.nextNode()
  }
  return null
}
