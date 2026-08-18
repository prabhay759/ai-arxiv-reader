import type { ReadingAnchor } from '@/types'

/**
 * Reading-position capture and restore.
 *
 * The naive approach — save `window.scrollY` — breaks the moment anything
 * changes the layout: a different font size, a rotated phone, a narrower
 * window, or arXiv re-rendering the paper. All of those are routine, so
 * positions are stored as *content* references instead:
 *
 *   HTML: the id of the block element at the top of the viewport, plus how far
 *         into it you are. LaTeXML gives every section and paragraph a stable
 *         id ("S3.p2"), which is exactly what this needs.
 *   PDF:  the page number plus a fraction of the way down that page, which is
 *         independent of zoom level.
 *
 * `percent` is always populated: it drives the progress UI, and is the
 * fallback when an anchor element no longer exists.
 */

/** Elements worth anchoring to — block-level content with a stable id. */
const ANCHORABLE = 'p[id], section[id], div[id].ltx_para, h1[id], h2[id], h3[id], figure[id], table[id]'

/**
 * Capture the current position within a scrolling HTML paper.
 *
 * @param container the element holding the paper markup
 * @param viewportTop y-coordinate treated as "the top of the reading area",
 *   which accounts for the sticky header overlaying the content
 */
export function captureHtmlAnchor(
  container: HTMLElement,
  viewportTop: number
): ReadingAnchor {
  const candidates = container.querySelectorAll<HTMLElement>(ANCHORABLE)

  let best: HTMLElement | undefined
  let bestTop = -Infinity

  // The anchor is the last element that starts at or above the reading line —
  // i.e. the block you are currently inside, not the next one down.
  for (const element of candidates) {
    const top = element.getBoundingClientRect().top
    if (top <= viewportTop + 1 && top > bestTop) {
      bestTop = top
      best = element
    }
  }

  const percent = documentScrollPercent()

  if (!best) return { mode: 'html', percent }

  // How far into the element the reading line falls, as a character offset —
  // more stable across reflow than a pixel offset would be.
  const rect = best.getBoundingClientRect()
  const fractionIntoElement =
    rect.height > 0 ? Math.min(1, Math.max(0, (viewportTop - rect.top) / rect.height)) : 0
  const textLength = best.textContent?.length ?? 0

  return {
    mode: 'html',
    elementId: best.id,
    charOffset: Math.round(fractionIntoElement * textLength),
    percent,
  }
}

/**
 * Scroll to a stored HTML anchor. Returns true when the anchor element was
 * found; false means the caller should fall back to `percent`.
 */
export function restoreHtmlAnchor(
  container: HTMLElement,
  anchor: ReadingAnchor,
  viewportTop: number
): boolean {
  if (!anchor.elementId) return false

  // getElementById would search the whole document; scope it to the paper so
  // an id colliding with app chrome can't hijack the restore.
  const element = container.querySelector<HTMLElement>(
    `[id="${CSS.escape(anchor.elementId)}"]`
  )
  if (!element) return false

  const rect = element.getBoundingClientRect()
  const textLength = element.textContent?.length ?? 0
  const fraction = textLength > 0 ? Math.min(1, (anchor.charOffset ?? 0) / textLength) : 0

  const target = window.scrollY + rect.top - viewportTop + fraction * rect.height
  window.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
  return true
}

/** Scroll to a fraction of the document, used when an anchor is stale. */
export function restoreByPercent(percent: number): void {
  const max = document.documentElement.scrollHeight - window.innerHeight
  window.scrollTo({ top: Math.max(0, max * percent), behavior: 'auto' })
}

export function documentScrollPercent(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight
  if (max <= 0) return 0
  return Math.min(1, Math.max(0, window.scrollY / max))
}

/**
 * Capture a position in the PDF reader.
 *
 * @param pageElements the rendered page containers, in order
 * @param viewportTop reading line, as for HTML
 */
export function capturePdfAnchor(
  pageElements: HTMLElement[],
  viewportTop: number,
  totalPages: number
): ReadingAnchor {
  let page = 1
  let pageOffset = 0

  for (let index = 0; index < pageElements.length; index += 1) {
    const rect = pageElements[index].getBoundingClientRect()
    if (rect.top <= viewportTop && rect.bottom > viewportTop) {
      page = index + 1
      // Fraction down the page, so the position holds at any zoom level.
      pageOffset = rect.height > 0 ? (viewportTop - rect.top) / rect.height : 0
      break
    }
    // Past the reading line: keep the last page above it.
    if (rect.top > viewportTop) break
    page = index + 1
    pageOffset = 0
  }

  const percent = totalPages > 0 ? Math.min(1, (page - 1 + pageOffset) / totalPages) : 0
  return { mode: 'pdf', page, pageOffset, percent }
}

/** Scroll the PDF viewer to a stored page + offset. */
export function restorePdfAnchor(
  pageElements: HTMLElement[],
  anchor: ReadingAnchor,
  viewportTop: number
): boolean {
  const index = (anchor.page ?? 1) - 1
  const element = pageElements[index]
  if (!element) return false

  const rect = element.getBoundingClientRect()
  const target = window.scrollY + rect.top - viewportTop + (anchor.pageOffset ?? 0) * rect.height
  window.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
  return true
}

/**
 * Debounce position saves, and always flush when the page is being hidden.
 *
 * `visibilitychange`/`pagehide` are the only reliably-delivered "user is
 * leaving" signals on mobile — a tab swipe or app switch never fires
 * `beforeunload` — and losing the last position is exactly the failure this
 * whole feature exists to prevent.
 */
export function createProgressSaver(
  save: () => void,
  delayMs = 900,
  maxDelayMs = 1200
): { schedule: () => void; flush: () => void; dispose: () => void } {
  let timer: number | undefined
  let firstRequestedAt: number | undefined

  const run = () => {
    timer = undefined
    firstRequestedAt = undefined
    save()
  }

  const flush = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    firstRequestedAt = undefined
    save()
  }

  /**
   * Debounced, but with a ceiling.
   *
   * A plain debounce can be deferred forever, and on a real paper it is:
   * figures load, the layout shifts, that fires another scroll event, and the
   * timer restarts. The position then never reaches IndexedDB while the page
   * is still settling — so a reader who scrolls and immediately reloads comes
   * back to the top, which is precisely the thing this file exists to prevent.
   * (`pagehide` flushes too, but a flush at teardown issues an async write the
   * browser will not wait for.)
   *
   * So: quiet for `delayMs` saves, and continuous activity still saves at
   * least every `maxDelayMs`. Measured on a real paper, a single scrollTo
   * produces ~40 scroll events over ~700ms as figures land, so the ceiling is
   * what actually bounds how stale the stored position can be.
   */
  const schedule = () => {
    const now = Date.now()
    if (firstRequestedAt === undefined) firstRequestedAt = now

    if (now - firstRequestedAt >= maxDelayMs) {
      if (timer !== undefined) window.clearTimeout(timer)
      run()
      return
    }

    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(run, Math.min(delayMs, firstRequestedAt + maxDelayMs - now))
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)

  return {
    schedule,
    flush,
    dispose() {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    },
  }
}
