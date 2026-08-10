import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Highlight, HighlightColor, PaperSummary, ReadingAnchor } from '@/types'
import { useAppStore } from '@/app/store'
import { ARXIV_PDF } from '@/app/services'
import { anchorFromSelection } from '@/store/highlights'
import { capturePdfAnchor, createProgressSaver, restorePdfAnchor } from './anchors'
import { HighlightMenu } from './HighlightMenu'

// Vite resolves the worker to a hashed asset URL so it is served same-origin
// and precached by the service worker — a CDN worker would break offline use.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const READING_LINE = 96
/** Render a window of pages around the viewport rather than the whole PDF. */
const RENDER_MARGIN = 2

interface PdfReaderProps {
  paper: PaperSummary
  initialAnchor?: ReadingAnchor
  highlights: Highlight[]
  onProgress: (anchor: ReadingAnchor, totalPages: number) => void
  onCreateHighlight: (anchor: ReturnType<typeof anchorFromSelection>, color: HighlightColor) => void
  onOutline: (outline: Array<{ label: string; page: number }>) => void
}

export function PdfReader({
  paper,
  initialAnchor,
  onProgress,
  onCreateHighlight,
  onOutline,
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<HTMLElement[]>([])
  const documentRef = useRef<PDFDocumentProxy>()

  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [visiblePage, setVisiblePage] = useState(1)

  const invertInDark = useAppStore((s) => s.reader.pdfInvertInDark)
  const restoredRef = useRef(false)
  const progressRef = useRef(onProgress)
  progressRef.current = onProgress
  const anchorRef = useRef(initialAnchor)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    restoredRef.current = false
    pageRefs.current = []

    // arXiv serves PDFs with `Access-Control-Allow-Origin: *`, so pdf.js can
    // fetch the bytes directly — no proxy, which is what keeps this backendless.
    const task = pdfjs.getDocument({ url: ARXIV_PDF(paper.id) })

    task.promise
      .then(async (doc) => {
        if (cancelled) {
          void doc.destroy()
          return
        }
        documentRef.current = doc
        setPageCount(doc.numPages)

        try {
          const outline = await doc.getOutline()
          if (outline?.length) onOutline(await flattenOutline(doc, outline))
        } catch {
          // Outline is optional; most arXiv PDFs have none.
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      void task.destroy()
      documentRef.current = undefined
    }
  }, [paper.id, onOutline])

  const registerPage = useCallback((index: number, node: HTMLElement | null) => {
    if (node) pageRefs.current[index] = node
  }, [])

  // Restore the saved page once enough pages exist to scroll to it.
  useEffect(() => {
    if (restoredRef.current || pageCount === 0) return
    const anchor = anchorRef.current
    if (!anchor?.page) {
      restoredRef.current = true
      return
    }

    // Pages render lazily, so wait until the target page element exists.
    const timer = window.setInterval(() => {
      if (pageRefs.current[(anchor.page ?? 1) - 1]) {
        restorePdfAnchor(pageRefs.current, anchor, READING_LINE)
        restoredRef.current = true
        window.clearInterval(timer)
      }
    }, 100)
    const stop = window.setTimeout(() => window.clearInterval(timer), 5000)

    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [pageCount])

  useEffect(() => {
    if (pageCount === 0) return

    const saver = createProgressSaver(() => {
      const anchor = capturePdfAnchor(pageRefs.current.filter(Boolean), READING_LINE, pageCount)
      setVisiblePage(anchor.page ?? 1)
      progressRef.current(anchor, pageCount)
    })

    const onScroll = () => saver.schedule()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      saver.flush()
      saver.dispose()
    }
  }, [pageCount])

  function goToPage(page: number) {
    const element = pageRefs.current[page - 1]
    if (!element) return
    window.scrollTo({
      top: window.scrollY + element.getBoundingClientRect().top - READING_LINE,
      behavior: 'smooth',
    })
  }

  if (error) {
    return (
      <div role="alert" className="card p-4 text-sm">
        <p>Couldn&rsquo;t load the PDF: {error}</p>
        <a className="btn mt-3" href={ARXIV_PDF(paper.id)} target="_blank" rel="noreferrer">
          Open on arXiv
        </a>
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface/95 px-2 py-1.5 backdrop-blur">
        <button type="button" className="btn btn-ghost px-2" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} aria-label="Zoom out">
          −
        </button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" className="btn btn-ghost px-2" onClick={() => setScale((s) => Math.min(3, s + 0.2))} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setScale(1.2)}>
          Fit width
        </button>

        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <label htmlFor="pdf-page" className="sr-only">
            Page number
          </label>
          <input
            id="pdf-page"
            type="number"
            min={1}
            max={pageCount || 1}
            value={visiblePage}
            onChange={(event) => {
              const page = Number(event.target.value)
              setVisiblePage(page)
              goToPage(page)
            }}
            className="w-14 rounded border border-edge bg-canvas px-1.5 py-0.5 text-center tabular-nums"
          />
          <span>of {pageCount || '—'}</span>
        </div>
      </div>

      <HighlightMenu
        containerRef={containerRef}
        onHighlight={(color) => {
          const selection = window.getSelection()
          const container = containerRef.current
          if (!selection || selection.isCollapsed || !container) return

          const range = selection.getRangeAt(0)
          const pageElement = (
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? (range.startContainer as HTMLElement)
              : range.startContainer.parentElement
          )?.closest('[data-page]')

          onCreateHighlight(
            anchorFromSelection(range, container, 'pdf', {
              page: Number(pageElement?.getAttribute('data-page') ?? visiblePage),
            }),
            color
          )
          selection.removeAllRanges()
        }}
      />

      <div
        ref={containerRef}
        className={`space-y-4 ${invertInDark ? 'pdf-invertable' : ''}`}
        aria-busy={loading}
      >
        {loading && <div className="h-96 animate-pulse rounded-lg bg-raised" />}
        {Array.from({ length: pageCount }, (_, index) => (
          <PdfPage
            key={index}
            index={index}
            document={documentRef}
            scale={scale}
            currentPage={visiblePage}
            register={registerPage}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One rendered page. Renders to canvas plus a transparent text layer, which is
 * what makes selection, in-page find and highlight anchoring work — a
 * canvas-only viewer would look right but be inert and inaccessible.
 */
function PdfPage({
  index,
  document: documentRef,
  scale,
  currentPage,
  register,
}: {
  index: number
  document: React.MutableRefObject<PDFDocumentProxy | undefined>
  scale: number
  currentPage: number
  register: (index: number, node: HTMLElement | null) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>()
  const renderedScaleRef = useRef<number>()

  const shouldRender = Math.abs(index + 1 - currentPage) <= RENDER_MARGIN

  useEffect(() => {
    register(index, wrapperRef.current)
  }, [index, register])

  useEffect(() => {
    const doc = documentRef.current
    if (!doc || !shouldRender) return
    if (renderedScaleRef.current === scale && size) return

    let cancelled = false
    let task: ReturnType<PDFPageProxy['render']> | undefined

    doc.getPage(index + 1).then(async (page) => {
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      // Render at device pixel ratio so text stays sharp on high-DPI screens.
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      setSize({ width: viewport.width, height: viewport.height })

      const context = canvas.getContext('2d')
      if (!context) return

      task = page.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      })

      try {
        await task.promise
      } catch {
        return // cancelled by a zoom change or unmount
      }
      if (cancelled) return
      renderedScaleRef.current = scale

      const layer = textLayerRef.current
      if (!layer) return
      layer.replaceChildren()
      const textContent = await page.getTextContent()
      if (cancelled) return

      const textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: layer,
        viewport,
      })
      await textLayer.render()
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [documentRef, index, scale, shouldRender, size])

  return (
    <div
      ref={wrapperRef}
      data-page={index + 1}
      className="relative mx-auto w-fit overflow-hidden rounded-lg border border-edge bg-white shadow-sm"
      style={size ? { width: size.width, height: size.height } : { minHeight: 600, width: '100%' }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={size ? { width: size.width, height: size.height } : undefined}
        aria-label={`Page ${index + 1}`}
      />
      <div ref={textLayerRef} className="pdf-text-layer" />
      {!shouldRender && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-faint">
          Page {index + 1}
        </div>
      )}
    </div>
  )
}

/** Resolve pdf.js outline destinations to page numbers. */
async function flattenOutline(
  doc: PDFDocumentProxy,
  outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
  depth = 0
): Promise<Array<{ label: string; page: number }>> {
  const entries: Array<{ label: string; page: number }> = []
  if (!outline || depth > 2) return entries

  for (const item of outline) {
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest
      if (dest) {
        const pageIndex = await doc.getPageIndex(dest[0] as never)
        entries.push({ label: item.title, page: pageIndex + 1 })
      }
    } catch {
      // Broken destination: skip this entry rather than losing the outline.
    }
    if (item.items?.length) entries.push(...(await flattenOutline(doc, item.items, depth + 1)))
  }
  return entries
}
