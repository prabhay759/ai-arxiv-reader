import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Highlight, HighlightColor, PaperSummary, ReadingAnchor } from '@/types'
import { anchorFromSelection, locateAnchor } from '@/store/highlights'
import {
  captureHtmlAnchor,
  createProgressSaver,
  documentScrollPercent,
  restoreByPercent,
  restoreHtmlAnchor,
} from './anchors'
import { fetchArxivHtml, HtmlUnavailableError, type ArxivHtmlDocument } from './arxivHtml'
import { buildUnits, type ReadingUnit } from './units'
import { HighlightMenu } from './HighlightMenu'
import { paintHighlights } from './paintHighlights'

/** Distance from the top of the viewport treated as the reading line. */
const READING_LINE = 96

interface HtmlReaderProps {
  paper: PaperSummary
  initialAnchor?: ReadingAnchor
  highlights: Highlight[]
  onProgress: (anchor: ReadingAnchor, totalSections: number) => void
  onCreateHighlight: (anchor: ReturnType<typeof anchorFromSelection>, color: HighlightColor) => void
  onSelectHighlight: (id: string) => void
  onToc: (toc: ArxivHtmlDocument['toc']) => void
  /** Called once the markup is in the DOM and the reading path is known. */
  onUnits: (units: ReadingUnit[]) => void
  /** Called on scroll with every unit finished so far, and the one being read. */
  onUnitProgress: (doneKeys: string[], currentKey?: string) => void
  onUnavailable: () => void
}

export function HtmlReader({
  paper,
  initialAnchor,
  highlights,
  onProgress,
  onCreateHighlight,
  onSelectHighlight,
  onToc,
  onUnits,
  onUnitProgress,
  onUnavailable,
}: HtmlReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [document_, setDocument] = useState<ArxivHtmlDocument>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const restoredRef = useRef(false)

  // Latest values for the scroll handler, which must not be re-bound on every
  // render or it would miss events during rapid scrolling.
  const progressRef = useRef(onProgress)
  progressRef.current = onProgress
  const unitProgressRef = useRef(onUnitProgress)
  unitProgressRef.current = onUnitProgress
  const anchorRef = useRef(initialAnchor)
  const unitsRef = useRef<ReadingUnit[]>([])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    setLoading(true)
    setError(undefined)
    restoredRef.current = false

    fetchArxivHtml(paper.id, controller.signal)
      .then((doc) => {
        if (cancelled) return
        setDocument(doc)
        onToc(doc.toc)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof HtmlUnavailableError) {
          onUnavailable()
          return
        }
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [paper.id, onToc, onUnavailable])

  // Restore the saved position once the markup is in the DOM. useLayoutEffect
  // so it happens before paint — the reader should never visibly jump.
  useLayoutEffect(() => {
    if (!document_ || restoredRef.current || !containerRef.current) return
    restoredRef.current = true

    const anchor = anchorRef.current
    if (!anchor) return

    // Images load after this runs and change the page height, so re-apply the
    // anchor once they settle. Without this the restore lands short on any
    // paper with figures.
    const apply = () => {
      const container = containerRef.current
      if (!container) return
      if (!restoreHtmlAnchor(container, anchor, READING_LINE)) {
        restoreByPercent(anchor.percent)
      }
    }

    apply()
    const images = [...(containerRef.current.querySelectorAll('img') ?? [])]
    const pending = images.filter((img) => !img.complete)
    if (pending.length === 0) return

    let settled = 0
    const onSettle = () => {
      settled += 1
      if (settled >= pending.length) apply()
    }
    pending.forEach((img) => {
      img.addEventListener('load', onSettle, { once: true })
      img.addEventListener('error', onSettle, { once: true })
    })
    // Don't wait forever on a figure that never loads.
    const timeout = window.setTimeout(apply, 2500)
    return () => window.clearTimeout(timeout)
  }, [document_])

  // Split the rendered paper into the reading path. Done after mount rather
  // than during parsing because it measures the live DOM — and deferred to
  // idle, because restoring the reader's saved position is what the first
  // moments after mount are for. The path appearing a beat later is
  // imperceptible; landing in the wrong place is not.
  useEffect(() => {
    const container = containerRef.current
    if (!document_ || !container) return

    const build = () => {
      if (!containerRef.current) return
      const units = buildUnits(containerRef.current)
      unitsRef.current = units
      onUnits(units)
    }

    // Safari only gained requestIdleCallback in 16.4; TypeScript's DOM lib
    // declares it unconditionally, so the guard has to be a runtime one.
    const idle =
      'requestIdleCallback' in window ? window.requestIdleCallback.bind(window) : undefined

    const handle = idle ? idle(build, { timeout: 2000 }) : window.setTimeout(build, 300)

    return () => {
      if (idle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [document_, onUnits])

  // Track scroll position and persist it.
  useEffect(() => {
    if (!document_) return
    const container = containerRef.current
    if (!container) return

    const saver = createProgressSaver(() => {
      const node = containerRef.current
      if (!node) return
      const sections = node.querySelectorAll('section[id]').length
      progressRef.current(captureHtmlAnchor(node, READING_LINE), sections)
      reportUnits(node, unitsRef.current, unitProgressRef.current)
    })

    const onScroll = () => saver.schedule()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      // Persist wherever the reader was left when navigating away.
      saver.flush()
      saver.dispose()
    }
  }, [document_])

  // Repaint highlights whenever they change or the paper re-renders.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !document_) return
    paintHighlights(container, highlights, locateAnchor, onSelectHighlight)
  }, [highlights, document_, onSelectHighlight])

  // Intra-paper links (citations, figure references) should scroll, not
  // navigate away from the app.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function onClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement).closest('a[data-internal]')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href?.startsWith('#')) return

      event.preventDefault()
      const target = container?.querySelector<HTMLElement>(`[id="${CSS.escape(href.slice(1))}"]`)
      if (!target) return
      window.scrollTo({
        top: window.scrollY + target.getBoundingClientRect().top - READING_LINE,
        behavior: 'smooth',
      })
    }

    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [document_])

  if (loading) {
    return (
      <div className="space-y-3 py-8" aria-busy="true" aria-label="Loading paper">
        {[...Array(8)].map((_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse rounded bg-raised"
            style={{ width: `${60 + ((index * 13) % 40)}%` }}
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="card p-4 text-sm">
        <p>Couldn&rsquo;t load the HTML version: {error}</p>
        <button type="button" className="btn mt-3" onClick={onUnavailable}>
          Switch to PDF
        </button>
      </div>
    )
  }

  return (
    <>
      <HighlightMenu
        containerRef={containerRef}
        onHighlight={(color) => {
          const selection = window.getSelection()
          const container = containerRef.current
          if (!selection || selection.isCollapsed || !container) return

          const range = selection.getRangeAt(0)
          const block = (
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? (range.startContainer as HTMLElement)
              : range.startContainer.parentElement
          )?.closest('[id]')

          onCreateHighlight(
            anchorFromSelection(range, container, 'html', { elementId: block?.id }),
            color
          )
          selection.removeAllRanges()
        }}
      />

      <div
        ref={containerRef}
        className="ltx-paper"
        // Sanitized in fetchArxivHtml with DOMPurify (MathML profile enabled).
        dangerouslySetInnerHTML={{ __html: document_?.html ?? '' }}
      />
    </>
  )
}

/**
 * Work out which units are finished and which one is being read.
 *
 * A unit counts as finished once the *next* unit's heading rises above the
 * reading line. Using the next unit's start rather than this one's end keeps
 * one rule for every case — a plain section, a section intro that stops where
 * its first subsection begins, and the collapsed appendix block — instead of
 * three that have to agree with each other.
 */
function reportUnits(
  container: HTMLElement,
  units: ReadingUnit[],
  report: (doneKeys: string[], currentKey?: string) => void
): void {
  if (units.length === 0) return

  const topOf = (elementId: string): number | undefined =>
    container
      .querySelector<HTMLElement>(`[id="${CSS.escape(elementId)}"]`)
      ?.getBoundingClientRect().top

  const done: string[] = []
  let current: string | undefined

  units.forEach((unit, index) => {
    const start = topOf(unit.elementId)
    if (start !== undefined && start <= READING_LINE) current = unit.key

    const next = units[index + 1]
    const boundary = next
      ? topOf(next.elementId)
      : container.getBoundingClientRect().bottom
    if (boundary !== undefined && boundary <= READING_LINE) done.push(unit.key)
  })

  report(done, current)
}

export { documentScrollPercent }
